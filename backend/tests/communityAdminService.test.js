const sqlite3 = require('sqlite3')
jest.mock('../db', () => ({}))
const { createCommunityAdminService } = require('../services/communityAdmin')

let database, service, client
beforeEach(async () => {
  database = new sqlite3.Database(':memory:')
  client = {
    get: jest.fn((sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row)))),
    all: jest.fn((sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))))
  }
  service = createCommunityAdminService(client)
  await new Promise((resolve, reject) => database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, avatar TEXT, created_at TEXT, last_seen TEXT, is_online INTEGER, is_admin INTEGER, email_verified INTEGER, password TEXT, google_id TEXT);
    CREATE TABLE friendships (user1_id INTEGER, user2_id INTEGER);
    CREATE TABLE messages (sender_id INTEGER, receiver_id INTEGER, content TEXT);
    CREATE TABLE group_messages (sender_id INTEGER, content TEXT);
    CREATE TABLE group_conversations (id INTEGER);
    CREATE TABLE practice_attempts (id INTEGER, user_id INTEGER, problem_id TEXT, language TEXT, solved INTEGER, created_at TEXT, solution_code TEXT);
    CREATE TABLE prompt_attempts (id INTEGER, user_id INTEGER, challenge_id TEXT, solved INTEGER, score INTEGER, created_at TEXT, prompt_text TEXT);
    CREATE TABLE battles_history (id INTEGER, problem_id TEXT, winner_id INTEGER, loser_id INTEGER, winner_language TEXT, loser_language TEXT, is_tie INTEGER, created_at TEXT, finished_at TEXT, winner_code TEXT);
    CREATE TABLE prompt_battle_history (id INTEGER, problem_id TEXT, player1_id TEXT, player2_id TEXT, player1_is_guest INTEGER, player2_is_guest INTEGER, winner_id TEXT, is_tie INTEGER, player1_score REAL, player2_score REAL, player1_adjusted_score REAL, player2_adjusted_score REAL, finished_at TEXT, player1_prompt TEXT);
    INSERT INTO users VALUES (7,'alice','alice@example.test','default-1','2026-01-01',NULL,1,1,1,'secret-password','private-oauth-id'),(8,'bob','bob@example.test','default-2','2026-01-02',NULL,0,0,0,'another-secret',NULL),(9,'a_b%','literal@example.test',NULL,'2026-01-03',NULL,0,0,0,'secret',NULL);
    INSERT INTO friendships VALUES (7,8);
    INSERT INTO messages VALUES (7,8,'private sent body'),(8,7,'private received body');
    INSERT INTO group_messages VALUES (7,'private group body');
    INSERT INTO group_conversations VALUES (1);
    INSERT INTO practice_attempts VALUES (1,7,'two-sum','python',1,'2026-01-01 12:00:00','private code');
    INSERT INTO prompt_attempts VALUES (2,7,'prompt-task',0,30,'2026-01-01T13:00:00Z','private prompt');
    INSERT INTO battles_history VALUES (3,'battle-task',8,7,'python','javascript',0,'2026-01-01','2026-01-01 14:00:00','private winner code');
    INSERT INTO prompt_battle_history VALUES (4,'prompt-battle-task','7','8',0,0,'7',0,90,30,80,25,'2026-01-01T15:00:00Z','private battle prompt');
    INSERT INTO prompt_battle_history VALUES (5,'guest-collision','7','guest-8',1,1,'7',0,90,30,NULL,NULL,'2026-01-02','private guest prompt');
  `, error => error ? reject(error) : resolve()))
})
afterEach(async () => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve())))

test('overview aggregates only consumer tables, without selecting message bodies', async () => {
  const result = await service.overview()
  expect(result.counts).toEqual({ members: 3, verifiedMembers: 1, onlineMembers: 1, friendships: 1, directMessages: 2, groupMessages: 1, groups: 1, codingPracticeAttempts: 1, promptPracticeAttempts: 1, codingBattles: 1, promptBattles: 2 })
  const sql = client.get.mock.calls[0][0]
  expect(sql).not.toMatch(/companies|assessments|interview|content|password|google_id/)
})

test('member search is parameterized and escapes SQL LIKE wildcards literally', async () => {
  const result = await service.members({ page: 1, limit: 25, search: 'a_b%' })
  expect(result.members.map(member => member.id)).toEqual([9])
  expect(client.all.mock.calls[0][1]).toEqual(['%a\\_b\\%%', '%a\\_b\\%%', 25, 0])
  const injected = await service.members({ page: 1, limit: 25, search: "' OR 1=1 --" })
  expect(injected.members).toEqual([])
  expect(client.all.mock.calls[1][0]).not.toContain("' OR 1=1 --")
})

test('member pagination has stable ordering and an explicit safe field whitelist', async () => {
  const result = await service.members({ page: 2, limit: 1, search: '' })
  expect(result.pagination).toEqual({ page: 2, limit: 1, total: 3, totalPages: 3 })
  expect(result.members[0].id).toBe(8)
  expect(Object.keys(result.members[0]).sort()).toEqual(['id','username','email','avatar','createdAt','lastSeen','isOnline','isAdmin','emailVerified'].sort())
  expect(JSON.stringify(result)).not.toMatch(/secret|password|oauth/i)
})

test('history merges consumer metadata chronologically, without guest identity collisions or private content', async () => {
  const result = await service.history(7, { page: 1, limit: 25 })
  expect(result.counts).toEqual({ friendships: 1, directMessagesSent: 1, directMessagesReceived: 1, groupMessagesSent: 1, codingPracticeAttempts: 1, promptPracticeAttempts: 1, codingBattles: 1, promptBattles: 1 })
  expect(result.activities.map(activity => activity.type)).toEqual(['prompt_battle','coding_battle','prompt_practice','coding_practice'])
  expect(result.activities[0]).toMatchObject({ id: 'prompt_battle:4', result: 'win', score: 80 })
  expect(result.activities[1]).toMatchObject({ language: 'javascript', result: 'loss' })
  expect(result.activities[3].result).toBe('solved')
  expect(result.pagination.total).toBe(4)
  expect(JSON.stringify(result)).not.toMatch(/private|secret|password|oauth|guest-collision/i)
})

test('history paginates consistently and missing members do not trigger activity queries', async () => {
  const result = await service.history(7, { page: 2, limit: 2 })
  expect(result.activities.map(activity => activity.type)).toEqual(['prompt_practice','coding_practice'])
  expect(result.pagination.totalPages).toBe(2)
  client.get.mockClear()
  client.all.mockClear()
  expect(await service.history(999, { page: 1, limit: 25 })).toBeNull()
  expect(client.get).toHaveBeenCalledTimes(1)
  expect(client.all).not.toHaveBeenCalled()
})
