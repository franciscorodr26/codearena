const db = require('../db')

const MEMBER_COLUMNS = 'id, username, email, avatar, created_at, last_seen, is_online, is_admin, email_verified'

function publicMember(row) {
  return {
    id: row.id, username: row.username, email: row.email, avatar: row.avatar,
    createdAt: row.created_at, lastSeen: row.last_seen,
    isOnline: row.is_online === 1, isAdmin: row.is_admin === 1,
    emailVerified: row.email_verified === 1
  }
}

function pagination(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) }
}

function escapeSearch(search) {
  return search.replace(/[\\%_]/g, character => `\\${character}`)
}

function createCommunityAdminService(database = db) {
  async function overview() {
    // Consumer tables only: never include company, assessment, or interview data.
    const counts = await database.get(`SELECT
      (SELECT COUNT(*) FROM users) AS members,
      (SELECT COUNT(*) FROM users WHERE email_verified = 1) AS verifiedMembers,
      (SELECT COUNT(*) FROM users WHERE is_online = 1) AS onlineMembers,
      (SELECT COUNT(*) FROM friendships) AS friendships,
      (SELECT COUNT(*) FROM messages) AS directMessages,
      (SELECT COUNT(*) FROM group_messages) AS groupMessages,
      (SELECT COUNT(*) FROM group_conversations) AS groups,
      (SELECT COUNT(*) FROM practice_attempts) AS codingPracticeAttempts,
      (SELECT COUNT(*) FROM prompt_attempts) AS promptPracticeAttempts,
      (SELECT COUNT(*) FROM battles_history) AS codingBattles,
      (SELECT COUNT(*) FROM prompt_battle_history) AS promptBattles`)
    return { counts, generatedAt: new Date().toISOString() }
  }

  async function members({ page, limit, search }) {
    const where = search ? "WHERE username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'" : ''
    const params = search ? [`%${escapeSearch(search)}%`, `%${escapeSearch(search)}%`] : []
    const total = (await database.get(`SELECT COUNT(*) AS total FROM users ${where}`, params)).total
    const rows = await database.all(`SELECT ${MEMBER_COLUMNS} FROM users ${where}
      ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit])
    return { members: rows.map(publicMember), pagination: pagination(page, limit, total) }
  }

  async function history(userId, { page, limit }) {
    const member = await database.get(`SELECT ${MEMBER_COLUMNS} FROM users WHERE id = ?`, [userId])
    if (!member) return null
    const textId = String(userId)
    const counts = await database.get(`SELECT
      (SELECT COUNT(*) FROM friendships WHERE user1_id = ? OR user2_id = ?) AS friendships,
      (SELECT COUNT(*) FROM messages WHERE sender_id = ?) AS directMessagesSent,
      (SELECT COUNT(*) FROM messages WHERE receiver_id = ?) AS directMessagesReceived,
      (SELECT COUNT(*) FROM group_messages WHERE sender_id = ?) AS groupMessagesSent,
      (SELECT COUNT(*) FROM practice_attempts WHERE user_id = ?) AS codingPracticeAttempts,
      (SELECT COUNT(*) FROM prompt_attempts WHERE user_id = ?) AS promptPracticeAttempts,
      (SELECT COUNT(*) FROM battles_history WHERE winner_id = ? OR loser_id = ?) AS codingBattles,
      (SELECT COUNT(*) FROM prompt_battle_history
        WHERE (player1_id = ? AND player1_is_guest = 0) OR (player2_id = ? AND player2_is_guest = 0)) AS promptBattles`,
    [userId, userId, userId, userId, userId, userId, userId, userId, userId, textId, textId])
    // Explicit metadata columns exclude submitted code, prompts, model output,
    // OAuth identifiers, private message content, and credentials.
    const rows = await database.all(`SELECT * FROM (
      SELECT id, 'coding_practice' AS type, created_at AS occurredAt, problem_id AS referenceId,
        language, CASE WHEN solved = 1 THEN 'solved' ELSE 'attempted' END AS result, NULL AS score
      FROM practice_attempts WHERE user_id = ?
      UNION ALL
      SELECT id, 'prompt_practice', created_at, challenge_id, NULL,
        CASE WHEN solved = 1 THEN 'solved' ELSE 'attempted' END, score
      FROM prompt_attempts WHERE user_id = ?
      UNION ALL
      SELECT id, 'coding_battle', COALESCE(finished_at, created_at), problem_id,
        CASE WHEN winner_id = ? THEN winner_language ELSE loser_language END,
        CASE WHEN is_tie = 1 THEN 'tie' WHEN winner_id = ? THEN 'win' ELSE 'loss' END, NULL
      FROM battles_history WHERE winner_id = ? OR loser_id = ?
      UNION ALL
      SELECT id, 'prompt_battle', finished_at, problem_id, NULL,
        CASE WHEN is_tie = 1 THEN 'tie' WHEN winner_id = ? THEN 'win' ELSE 'loss' END,
        CASE WHEN player1_id = ? AND player1_is_guest = 0
          THEN COALESCE(player1_adjusted_score, player1_score) ELSE COALESCE(player2_adjusted_score, player2_score) END
      FROM prompt_battle_history
      WHERE (player1_id = ? AND player1_is_guest = 0) OR (player2_id = ? AND player2_is_guest = 0)
    ) ORDER BY julianday(occurredAt) DESC, type ASC, id DESC LIMIT ? OFFSET ?`,
    [userId, userId, userId, userId, userId, userId, textId, textId, textId, textId, limit, (page - 1) * limit])
    const total = counts.codingPracticeAttempts + counts.promptPracticeAttempts + counts.codingBattles + counts.promptBattles
    return {
      member: publicMember(member), counts,
      activities: rows.map(row => ({
        id: `${row.type}:${row.id}`, type: row.type, occurredAt: row.occurredAt,
        referenceId: row.referenceId, language: row.language, result: row.result, score: row.score
      })),
      pagination: pagination(page, limit, total)
    }
  }

  return { overview, members, history }
}

module.exports = { ...createCommunityAdminService(), createCommunityAdminService }
