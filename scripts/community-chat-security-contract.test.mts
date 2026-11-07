import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const resolvers = fs.readFileSync(path.join(ROOT, "apps/web/graphql/resolvers.ts"), "utf8");
const between = (start: string, end: string) =>
  resolvers.slice(resolvers.indexOf(start), resolvers.indexOf(end, resolvers.indexOf(start)));

test("message list and cursor list require current chat membership", () => {
  const list = between("messages: async (", "messagesConnection: async (");
  const connection = between("messagesConnection: async (", "roles: async (");
  for (const source of [list, connection]) {
    assert.match(source, /EXISTS \([\s\S]*FROM chat_members cm[\s\S]*cm\.chat_id = m\.chat_id AND cm\.user_id = \$2/);
  }
});

test("sending checks room membership, recipients and reply ownership before insert", () => {
  const send = between("sendMessage: async (", "updateUser:");
  assert.match(send, /rawTo\.some\(\(id\) => !UUID_RE\.test\(id\)\)/,
    "malformed recipient ids must fail instead of being silently dropped");
  assert.match(send, /reply_to_id && !UUID_RE\.test\(String\(reply_to_id\)\)/,
    "malformed reply ids must fail before reaching PostgreSQL");
  assert.match(send, /SELECT user_id FROM chat_members WHERE chat_id = \$1/);
  assert.match(send, /if \(!memberIds\.has\(author_id\)\)/);
  assert.match(send, /cleanTo\.some\(\(id\) => !memberIds\.has\(id\)\)/);
  assert.match(send, /FOR SHARE/,
    "membership rows must be rechecked and locked in the write transaction");
  assert.match(send, /SELECT 1 FROM messages WHERE id = \$1 AND chat_id = \$2/,
    "reply_to must not expose a message from another chat");
  assert.ok(send.indexOf("memberIds.has(author_id)") < send.indexOf("Pre-upload images"),
    "authorization must happen before storing upload bytes");
});

test("chat management mutations cannot target an enumerated room or message", () => {
  const addMember = between("addMember: async", "sendMessage: async");
  const rename = between("renameChat: async", "deleteChat: async");
  const removeChat = between("deleteChat: async", "updateMyChatSettings: async");
  const removeMessage = between("deleteMessage: async", "deleteFile: async");

  assert.match(addMember, /JOIN chat_members mine ON mine\.chat_id = c\.id AND mine\.user_id = \$2/);
  assert.match(addMember, /if \(!membership\.rows\[0\]\?\.is_group\)/,
    "only an existing member can add to a group chat");
  assert.match(rename, /FROM chat_members cm[\s\S]*cm\.user_id = \$3/,
    "rename requires membership");
  assert.match(removeChat, /WHERE id = \$1 AND created_by = \$2/,
    "global chat deletion is creator-only");
  assert.match(removeMessage, /WHERE id = \$1 AND sender_id = \$2/,
    "message deletion is sender-only");
});

test("get-or-create DM is validated, serialized and atomic", () => {
  const dm = between("getOrCreateDm: async", "myChats: async");
  assert.match(dm, /!UUID_RE\.test\(peerId\) \|\| peerId === actorId/);
  assert.match(dm, /pg_advisory_xact_lock/);
  assert.match(dm, /SELECT 1 FROM users WHERE id = \$1 LIMIT 1/);
  assert.match(dm, /runInTransaction\(actorId/);
  assert.match(dm, /INSERT INTO chat_members\(chat_id, user_id\)/);
  assert.match(dm, /VALUES \(\$1,\$2\),\(\$1,\$3\)/);
});

test("chat resolvers never print the request context with cookies or authorization headers", () => {
  assert.doesNotMatch(resolvers, /console\.(?:log|info|error)\([^\n]*,\s*ctx(?:\s*,|\s*\))/);
});
