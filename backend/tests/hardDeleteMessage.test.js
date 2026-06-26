// Hard-delete message feature tests for db.js (deleteMessage / deleteGroupMessage).
//
// CRITICAL: db.js opens its singleton sqlite connection at module-load time,
// resolving DB_PATH at require() time. We MUST point at an isolated temp file
// BEFORE requiring ../db, otherwise tests would hard-delete rows from the real
// dev data.sqlite. Do not move this into beforeAll.
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join('/tmp', `hard-delete-test-${process.pid}-${Date.now()}.sqlite`);
process.env.DB_PATH = TEST_DB_PATH;

const db = require('../db');

// Helper: read raw conversation row between two users (mirrors createMessage ordering)
async function getConversationRow(uA, uB) {
  const [u1, u2] = uA < uB ? [uA, uB] : [uB, uA];
  return db.get('SELECT * FROM conversations WHERE user1_id = ? AND user2_id = ?', [u1, u2]);
}

async function getGroupRow(groupId) {
  return db.get('SELECT * FROM group_conversations WHERE id = ?', [groupId]);
}

// Insert a reaction directly so we control exactly which message it is attached to.
async function insertMessageReaction(messageId, userId, emoji) {
  await db.run(
    'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
    [messageId, userId, emoji, new Date().toISOString()]
  );
}
async function insertGroupReaction(groupMessageId, userId, emoji) {
  await db.run(
    'INSERT INTO group_message_reactions (group_message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
    [groupMessageId, userId, emoji, new Date().toISOString()]
  );
}

let userA, userB, userC;

beforeAll(async () => {
  // Insurance: never run against the real dev DB.
  expect(process.env.DB_PATH).toBe(TEST_DB_PATH);
  expect(TEST_DB_PATH.endsWith('data.sqlite')).toBe(false);

  await db.init();

  const a = await db.createUser('hd_a@test.com', 'pw', 'hd_alice');
  const b = await db.createUser('hd_b@test.com', 'pw', 'hd_bob');
  const c = await db.createUser('hd_c@test.com', 'pw', 'hd_carol');
  userA = a.id;
  userB = b.id;
  userC = c.id;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(TEST_DB_PATH + suffix); } catch (_) {}
  }
});

// Each DM test gets its own pair of users to avoid cross-test conversation state.
// We reuse the 3 base users but clean messages/reactions/conversations between DM tests.
async function clearDmState() {
  await db.run('DELETE FROM message_reactions');
  await db.run('DELETE FROM messages');
  await db.run('DELETE FROM conversations');
}

describe('deleteMessage (direct messages)', () => {
  beforeEach(clearDmState);

  test('delete own DM -> success, row gone, returns lastMessage', async () => {
    const m1 = await db.createMessage(userA, userB, 'first');
    const m2 = await db.createMessage(userA, userB, 'second'); // newest

    const res = await db.deleteMessage(m2.id, userA);

    expect(res.success).toBe(true);
    expect(res.message).toEqual({ id: m2.id, sender_id: userA, receiver_id: userB });

    // Row is GONE from messages
    const gone = await db.get('SELECT * FROM messages WHERE id = ?', [m2.id]);
    expect(gone).toBeUndefined();

    // lastMessage repointed to M1
    expect(res.lastMessage).toBeTruthy();
    expect(res.lastMessage.id).toBe(m1.id);
    expect(res.lastMessage.content).toBe('first');
  });

  test("deleting another user's message is blocked, row stays", async () => {
    const m1 = await db.createMessage(userA, userB, 'mine');

    // userB tries to delete userA's message
    const res = await db.deleteMessage(m1.id, userB);

    expect(res.success).toBe(false);
    expect(res.error).toBe('You can only delete your own messages');

    const stillThere = await db.get('SELECT * FROM messages WHERE id = ?', [m1.id]);
    expect(stillThere).toBeTruthy();
    expect(stillThere.content).toBe('mine');
  });

  test('delete missing id -> Message not found', async () => {
    const res = await db.deleteMessage(99999999, userA);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Message not found');
  });

  test('parseInt coercion: string ids still work', async () => {
    const m1 = await db.createMessage(userA, userB, 'coerce me');

    const res = await db.deleteMessage(String(m1.id), String(userA));

    expect(res.success).toBe(true);
    expect(res.message.id).toBe(m1.id);
    const gone = await db.get('SELECT * FROM messages WHERE id = ?', [m1.id]);
    expect(gone).toBeUndefined();
  });

  test('deleting own message reactions are removed; other messages reactions untouched', async () => {
    const m1 = await db.createMessage(userA, userB, 'keep');
    const m2 = await db.createMessage(userA, userB, 'delete'); // newest

    // reactions on BOTH messages
    await insertMessageReaction(m1.id, userB, '🔥');
    await insertMessageReaction(m2.id, userB, '👍');
    await insertMessageReaction(m2.id, userA, '❤️');

    const res = await db.deleteMessage(m2.id, userA);
    expect(res.success).toBe(true);

    // m2 reactions gone
    const m2Reactions = await db.all('SELECT * FROM message_reactions WHERE message_id = ?', [m2.id]);
    expect(m2Reactions).toHaveLength(0);

    // m1 reaction untouched
    const m1Reactions = await db.all('SELECT * FROM message_reactions WHERE message_id = ?', [m1.id]);
    expect(m1Reactions).toHaveLength(1);
    expect(m1Reactions[0].emoji).toBe('🔥');
  });

  test('last-message repoint chain: delete newest -> M1, delete M1 -> NULL', async () => {
    const m1 = await db.createMessage(userA, userB, 'M1 older');
    const m2 = await db.createMessage(userA, userB, 'M2 newest');

    // sanity: conversation points at M2
    let conv = await getConversationRow(userA, userB);
    expect(conv.last_message_id).toBe(m2.id);

    // delete M2 -> repoint to M1
    const r2 = await db.deleteMessage(m2.id, userA);
    expect(r2.lastMessage.id).toBe(m1.id);
    conv = await getConversationRow(userA, userB);
    expect(conv.last_message_id).toBe(m1.id);
    expect(conv.last_activity).toBe(r2.lastMessage.created_at);

    // delete M1 -> repoint to NULL, lastMessage null
    const r1 = await db.deleteMessage(m1.id, userA);
    expect(r1.lastMessage).toBeNull();
    conv = await getConversationRow(userA, userB);
    expect(conv.last_message_id).toBeNull();
  });

  test('deleting a NON-last message keeps last_message_id at newest', async () => {
    const m1 = await db.createMessage(userA, userB, 'M1 older');
    const m2 = await db.createMessage(userA, userB, 'M2 newest');

    // delete the OLDER message (m1) while m2 is still newest
    const res = await db.deleteMessage(m1.id, userA);
    expect(res.success).toBe(true);
    expect(res.lastMessage.id).toBe(m2.id);

    const conv = await getConversationRow(userA, userB);
    expect(conv.last_message_id).toBe(m2.id);
  });

  test('getConversationMessages no longer returns deleted row', async () => {
    const m1 = await db.createMessage(userA, userB, 'keep me');
    const m2 = await db.createMessage(userA, userB, 'remove me');

    await db.deleteMessage(m2.id, userA);

    const msgs = await db.getConversationMessages(userA, userB, 50, 0);
    const ids = msgs.map(m => m.id);
    expect(ids).toContain(m1.id);
    expect(ids).not.toContain(m2.id);
  });

  test('repoint exercises B->A direction (second OR branch): delete B->A newest -> finds A->B older', async () => {
    const m1 = await db.createMessage(userA, userB, 'A to B older');
    const m2 = await db.createMessage(userB, userA, 'B to A newest'); // opposite direction, sent by B

    let conv = await getConversationRow(userA, userB);
    expect(conv.last_message_id).toBe(m2.id);

    // userB deletes their own B->A message; repoint must still find the A->B message
    const res = await db.deleteMessage(m2.id, userB);
    expect(res.success).toBe(true);
    expect(res.lastMessage.id).toBe(m1.id);
    conv = await getConversationRow(userA, userB);
    expect(conv.last_message_id).toBe(m1.id);
  });

  test('OBSERVATION: emptying a conversation sets last_message_id NULL but leaves last_activity stale', async () => {
    const m1 = await db.createMessage(userA, userB, 'only message');
    const convBefore = await getConversationRow(userA, userB);
    const staleActivity = convBefore.last_activity;

    const res = await db.deleteMessage(m1.id, userA);
    expect(res.lastMessage).toBeNull();

    const conv = await getConversationRow(userA, userB);
    expect(conv.last_message_id).toBeNull();
    // Documents current behavior: last_activity is NOT reset (spec-ambiguous, not a confirmed bug).
    expect(conv.last_activity).toBe(staleActivity);
  });
});

describe('deleteGroupMessage (group messages)', () => {
  let groupId;

  beforeEach(async () => {
    await db.run('DELETE FROM group_message_reactions');
    await db.run('DELETE FROM group_messages');
    await db.run('DELETE FROM group_members');
    await db.run('DELETE FROM group_conversations');
    const group = await db.createGroupConversation('HD Test Group', userA, [userB, userC]);
    groupId = group.id;
  });

  test('delete own group message -> success, row gone, lastMessage has sender_username', async () => {
    const g1 = await db.createGroupMessage(groupId, userA, 'g first');
    const g2 = await db.createGroupMessage(groupId, userB, 'g second'); // newest, by userB

    const res = await db.deleteGroupMessage(g2.id, userB);

    expect(res.success).toBe(true);
    expect(res.message).toEqual({ id: g2.id, group_id: groupId });

    const gone = await db.get('SELECT * FROM group_messages WHERE id = ?', [g2.id]);
    expect(gone).toBeUndefined();

    // lastMessage repointed to g1 and includes sender_username (group-specific contract)
    expect(res.lastMessage).toBeTruthy();
    expect(res.lastMessage.id).toBe(g1.id);
    expect(res.lastMessage.sender_username).toBe('hd_alice');
  });

  test("blocking: cannot delete another user's group message", async () => {
    const g1 = await db.createGroupMessage(groupId, userA, 'alice msg');
    const res = await db.deleteGroupMessage(g1.id, userB);
    expect(res.success).toBe(false);
    expect(res.error).toBe('You can only delete your own messages');
    const stillThere = await db.get('SELECT * FROM group_messages WHERE id = ?', [g1.id]);
    expect(stillThere).toBeTruthy();
  });

  test('group: missing id -> Message not found', async () => {
    const res = await db.deleteGroupMessage(88888888, userA);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Message not found');
  });

  test('group parseInt coercion: string ids work', async () => {
    const g1 = await db.createGroupMessage(groupId, userA, 'coerce group');
    const res = await db.deleteGroupMessage(String(g1.id), String(userA));
    expect(res.success).toBe(true);
    expect(res.message.id).toBe(g1.id);
  });

  test('group reactions removed for deleted msg; other msg reactions untouched', async () => {
    const g1 = await db.createGroupMessage(groupId, userA, 'keep group');
    const g2 = await db.createGroupMessage(groupId, userA, 'delete group');

    await insertGroupReaction(g1.id, userB, '🔥');
    await insertGroupReaction(g2.id, userB, '👍');
    await insertGroupReaction(g2.id, userC, '❤️');

    const res = await db.deleteGroupMessage(g2.id, userA);
    expect(res.success).toBe(true);

    const g2Reactions = await db.all('SELECT * FROM group_message_reactions WHERE group_message_id = ?', [g2.id]);
    expect(g2Reactions).toHaveLength(0);

    const g1Reactions = await db.all('SELECT * FROM group_message_reactions WHERE group_message_id = ?', [g1.id]);
    expect(g1Reactions).toHaveLength(1);
    expect(g1Reactions[0].emoji).toBe('🔥');
  });

  test('group last-message repoint chain: newest -> g1 -> NULL', async () => {
    const g1 = await db.createGroupMessage(groupId, userA, 'g1');
    const g2 = await db.createGroupMessage(groupId, userB, 'g2 newest');

    let grp = await getGroupRow(groupId);
    expect(grp.last_message_id).toBe(g2.id);

    const r2 = await db.deleteGroupMessage(g2.id, userB);
    expect(r2.lastMessage.id).toBe(g1.id);
    grp = await getGroupRow(groupId);
    expect(grp.last_message_id).toBe(g1.id);
    expect(grp.last_activity).toBe(r2.lastMessage.created_at);

    const r1 = await db.deleteGroupMessage(g1.id, userA);
    expect(r1.lastMessage).toBeNull();
    grp = await getGroupRow(groupId);
    expect(grp.last_message_id).toBeNull();
  });

  test('group: deleting NON-last message keeps last_message_id at newest', async () => {
    const g1 = await db.createGroupMessage(groupId, userA, 'g1 older');
    const g2 = await db.createGroupMessage(groupId, userB, 'g2 newest');

    const res = await db.deleteGroupMessage(g1.id, userA);
    expect(res.success).toBe(true);
    expect(res.lastMessage.id).toBe(g2.id);

    const grp = await getGroupRow(groupId);
    expect(grp.last_message_id).toBe(g2.id);
  });

  test('getGroupMessages no longer returns deleted row', async () => {
    const g1 = await db.createGroupMessage(groupId, userA, 'keep group msg');
    const g2 = await db.createGroupMessage(groupId, userB, 'remove group msg');

    await db.deleteGroupMessage(g2.id, userB);

    const msgs = await db.getGroupMessages(groupId, 50, 0);
    const ids = msgs.map(m => m.id);
    expect(ids).toContain(g1.id);
    expect(ids).not.toContain(g2.id);
  });
});
