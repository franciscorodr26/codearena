process.env.JWT_SECRET = 'test-secret-key'

jest.mock('../services/gameVerification', () => ({
  verifyGeneratedGame: jest.fn()
}))

jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    const auth = req.headers.authorization || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    req.user = { sub: Number(token) || token }
    next()
  }
}))

const db = require('../db')
const gamesRouter = require('../routes/games')
const { verifyGeneratedGame } = require('../services/gameVerification')
describe('game verification routes', () => {
  const createdGameIds = []
  const createdUserIds = []

  beforeAll(async () => {
    await db.run(`CREATE TABLE IF NOT EXISTS game_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
      spec_json TEXT,
      static_status TEXT NOT NULL,
      runtime_status TEXT NOT NULL,
      accuracy_status TEXT NOT NULL,
      overall_status TEXT NOT NULL,
      accuracy_score REAL DEFAULT 0,
      findings_json TEXT,
      artifacts_json TEXT,
      verifier_version TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
  })

  function getRouteHandlers(path, method) {
    const normalizedMethod = method.toLowerCase()
    const layer = gamesRouter.stack.find(entry => (
      entry.route && entry.route.path === path && entry.route.methods[normalizedMethod]
    ))
    if (!layer) {
      throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
    }
    return layer.route.stack.map(entry => entry.handle)
  }

  async function invokeRoute(path, method, { params = {}, headers = {}, body = {} }) {
    const handlers = getRouteHandlers(path, method)
    const req = {
      method: method.toUpperCase(),
      params,
      headers,
      body
    }

    let statusCode = 200
    let jsonBody

    const res = {
      status(code) {
        statusCode = code
        return this
      },
      json(payload) {
        jsonBody = payload
        return this
      }
    }

    for (const handler of handlers) {
      let nextCalled = false
      await handler(req, res, () => {
        nextCalled = true
      })
      if (!nextCalled || jsonBody !== undefined) break
    }

    return { status: statusCode, body: jsonBody }
  }

  afterEach(async () => {
    for (const gameId of createdGameIds.splice(0)) {
      try {
        await db.run('DELETE FROM games WHERE id = ?', [gameId])
      } catch (_) {
        // Best effort cleanup
      }
    }
    for (const userId of createdUserIds.splice(0)) {
      try {
        await db.run('DELETE FROM users WHERE id = ?', [userId])
      } catch (_) {
        // Best effort cleanup
      }
    }
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('verifies latest saved version and allows publish for passing result', async () => {
    const userInsert = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`verify_user_${Date.now()}`, `verify_${Date.now()}@example.com`, 'hash']
    )
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userInsert.lastID])
    const token = String(user.id)
    createdUserIds.push(user.id)
    const game = await db.createGame(user.id, {
      title: 'Verification Game',
      description: 'Shooter with score',
      gameType: 'browser',
      htmlContent: '<!DOCTYPE html><html><body><canvas></canvas><script>requestAnimationFrame(function loop(){requestAnimationFrame(loop)})</script></body></html>'
    })
    createdGameIds.push(game.id)

    verifyGeneratedGame.mockResolvedValue({
      verifierVersion: 'test-verifier',
      spec: { requiresScore: true },
      staticResult: { status: 'passed', findings: [] },
      runtimeResult: { status: 'passed', findings: [], artifacts: {} },
      accuracyResult: { status: 'passed', score: 0.9, findings: [] },
      overallStatus: 'passed',
      findings: [],
      artifacts: {}
    })

    const verifyRes = await invokeRoute('/:id/verify', 'post', {
      params: { id: String(game.id) },
      headers: { authorization: `Bearer ${token}` }
    })

    expect(verifyRes.status).toBe(200)
    expect(verifyRes.body.success).toBe(true)
    expect(verifyRes.body.verification.overallStatus).toBe('passed')

    const cachedVerifyRes = await invokeRoute('/:id/verify', 'post', {
      params: { id: String(game.id) },
      headers: { authorization: `Bearer ${token}` }
    })

    expect(cachedVerifyRes.status).toBe(200)
    expect(cachedVerifyRes.body.cached).toBe(true)
    expect(verifyGeneratedGame).toHaveBeenCalledTimes(1)

    const publishRes = await invokeRoute('/:id/publish', 'post', {
      params: { id: String(game.id) },
      headers: { authorization: `Bearer ${token}` }
    })

    expect(publishRes.status).toBe(200)
    expect(publishRes.body.success).toBe(true)
  })

  it('rejects uncached verification when the daily cost circuit breaker is exhausted', async () => {
    const userInsert = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`quota_user_${Date.now()}`, `quota_${Date.now()}@example.com`, 'hash']
    )
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userInsert.lastID])
    createdUserIds.push(user.id)
    const game = await db.createGame(user.id, {
      title: 'Quota Verification Game',
      description: 'A game that should not reach paid verification',
      gameType: 'browser',
      htmlContent: '<!DOCTYPE html><html><body><canvas></canvas><script>requestAnimationFrame(function loop(){requestAnimationFrame(loop)})</script></body></html>'
    })
    createdGameIds.push(game.id)

    jest.spyOn(db, 'tryConsumeConsumerDailyUsage').mockResolvedValue({
      allowed: false,
      reason: 'global_limit'
    })

    const verifyRes = await invokeRoute('/:id/verify', 'post', {
      params: { id: String(game.id) },
      headers: { authorization: `Bearer ${user.id}` }
    })

    expect(verifyRes.status).toBe(429)
    expect(verifyRes.body).toMatchObject({
      limitReached: true,
      globalLimitReached: true,
      dailyLimit: 100
    })
    expect(verifyGeneratedGame).not.toHaveBeenCalled()
  })

  it('stores prompt_used on the first saved version for future verification accuracy', async () => {
    const userInsert = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`prompt_user_${Date.now()}`, `prompt_${Date.now()}@example.com`, 'hash']
    )
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userInsert.lastID])
    createdUserIds.push(user.id)

    const game = await db.createGame(user.id, {
      title: 'Prompt Persistence Game',
      description: 'Stored prompt check',
      gameType: 'browser',
      htmlContent: '<!DOCTYPE html><html><body><canvas></canvas><script>requestAnimationFrame(function loop(){requestAnimationFrame(loop)})</script></body></html>',
      promptUsed: 'Make a neon game with score and restart on R.'
    })
    createdGameIds.push(game.id)

    const latestVersion = await db.getLatestGameVersion(game.id)
    expect(latestVersion.prompt_used).toBe('Make a neon game with score and restart on R.')
  })

  it('saves a revision to both the canonical game and version history with its prompt', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const userInsert = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`revision_user_${suffix}`, `revision_${suffix}@example.com`, 'hash']
    )
    createdUserIds.push(userInsert.lastID)
    const game = await db.createGame(userInsert.lastID, {
      title: 'Revision Save Game',
      gameType: 'browser',
      htmlContent: '<html><body>original</body></html>'
    })
    createdGameIds.push(game.id)
    const revisedHtml = '<html><body>saved revision</body></html>'
    const revisionPrompt = 'Make the movement smoother and add a score counter.'

    const updateRes = await invokeRoute('/:id', 'put', {
      params: { id: String(game.id) },
      headers: { authorization: `Bearer ${userInsert.lastID}` },
      body: {
        title: 'Revision Save Game',
        htmlContent: revisedHtml,
        promptUsed: revisionPrompt
      }
    })

    const [canonicalGame, latestVersion] = await Promise.all([
      db.getGameById(game.id),
      db.getLatestGameVersion(game.id)
    ])

    expect(updateRes.status).toBe(200)
    expect(canonicalGame.html_content).toBe(revisedHtml)
    expect(latestVersion.html_content).toBe(revisedHtml)
    expect(latestVersion.prompt_used).toBe(revisionPrompt)
  })

  it('blocks publish when latest version is newer than latest passing verification', async () => {
    const userInsert = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`stale_user_${Date.now()}`, `stale_${Date.now()}@example.com`, 'hash']
    )
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userInsert.lastID])
    const token = String(user.id)
    createdUserIds.push(user.id)
    const game = await db.createGame(user.id, {
      title: 'Stale Verification Game',
      description: 'Shooter with score',
      gameType: 'browser',
      htmlContent: '<!DOCTYPE html><html><body><canvas></canvas><script>requestAnimationFrame(function loop(){requestAnimationFrame(loop)})</script></body></html>'
    })
    createdGameIds.push(game.id)

    verifyGeneratedGame.mockResolvedValue({
      verifierVersion: 'test-verifier',
      spec: { requiresScore: true },
      staticResult: { status: 'passed', findings: [] },
      runtimeResult: { status: 'passed', findings: [], artifacts: {} },
      accuracyResult: { status: 'passed', score: 0.9, findings: [] },
      overallStatus: 'passed',
      findings: [],
      artifacts: {}
    })

    const verifyRes = await invokeRoute('/:id/verify', 'post', {
      params: { id: String(game.id) },
      headers: { authorization: `Bearer ${token}` }
    })

    expect(verifyRes.status).toBe(200)

    await db.updateGame(game.id, {
      htmlContent: '<!DOCTYPE html><html><body><canvas></canvas><div>Score</div><script>requestAnimationFrame(function loop(){requestAnimationFrame(loop)})</script></body></html>'
    })

    const publishRes = await invokeRoute('/:id/publish', 'post', {
      params: { id: String(game.id) },
      headers: { authorization: `Bearer ${token}` }
    })

    expect(publishRes.status).toBe(409)
    expect(publishRes.body.code).toBe('VERIFICATION_REQUIRED')
  })

  it('retains only the newest 50 game versions', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const userInsert = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`versions_${suffix}`, `versions_${suffix}@example.com`, 'hash']
    )
    createdUserIds.push(userInsert.lastID)
    const game = await db.createGame(userInsert.lastID, {
      title: 'Bounded History Game',
      gameType: 'browser',
      htmlContent: '<html><body>v1</body></html>'
    })
    createdGameIds.push(game.id)

    for (let version = 2; version <= 56; version += 1) {
      await db.addGameVersion(game.id, {
        htmlContent: `<html><body>v${version}</body></html>`
      })
    }

    const summary = await db.get(
      `SELECT COUNT(*) AS count, MIN(version_number) AS oldest,
              MAX(version_number) AS newest
       FROM game_versions WHERE game_id = ?`,
      [game.id]
    )
    expect(summary).toEqual({ count: 50, oldest: 7, newest: 56 })
  })

  it('omits full HTML payloads from gallery and leaderboard lists', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const userInsert = await db.run(
      `INSERT INTO users (username, email, password, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [`listing_${suffix}`, `listing_${suffix}@example.com`, 'hash']
    )
    createdUserIds.push(userInsert.lastID)
    const game = await db.createGame(userInsert.lastID, {
      title: `Payload ${suffix}`,
      gameType: 'browser',
      htmlContent: '<html><body>large game payload</body></html>'
    })
    createdGameIds.push(game.id)
    await db.publishGame(game.id)

    const gallery = await db.getPublishedGames({ search: `Payload ${suffix}`, limit: 20 })
    const leaderboard = await db.getTopRatedGames(25)
    const listedGame = leaderboard.find(entry => entry.id === game.id)

    expect(gallery.games).toHaveLength(1)
    expect(gallery.games[0]).not.toHaveProperty('html_content')
    expect(listedGame).toBeDefined()
    expect(listedGame).not.toHaveProperty('html_content')
  })
})
