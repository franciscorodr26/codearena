/**
 * Prompt battle: scoring helper + Socket.IO match delivery (two clients get pb-match-found).
 */
const http = require('http')
const { Server } = require('socket.io')
const { io: ioc } = require('socket.io-client')
jest.mock('../services/promptBattleRunner', () => ({
  runPlayerModel: jest.fn(async () => ({
    text: 'Mock model output for preview',
    inputTokens: 12,
    outputTokens: 34,
    totalTokens: 46
  })),
  countPromptTokens: jest.fn(async () => 10),
  getAvailablePromptBattleModels: jest.fn(() => [
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' }
  ]),
  getDefaultPromptBattleModelId: jest.fn(() => 'claude-haiku-4-5'),
  sanitizeModelId: jest.fn((modelId) => modelId || 'claude-haiku-4-5')
}))
jest.mock('../services/promptModelOutputScore', () => ({
  evaluateModelOutputTiered: jest.fn(() => ({
    scorePercent: 77,
    tierResults: [],
    passedTierId: null
  }))
}))
const {
  registerPromptBattleHandlers,
  adjustedScoreFromSubmits,
  rooms,
  promptRoomCreationAttempts,
  checkPromptRoomCreationRate,
  getPromptRoomAllocationStatus,
  pruneExpiredPromptRooms,
  MAX_PROMPT_BATTLE_ROOMS,
  PROMPT_ROOM_CREATE_LIMIT
} = require('../services/promptBattleSocket')

describe('adjustedScoreFromSubmits', () => {
  it('leaves score unchanged for first submission', () => {
    expect(adjustedScoreFromSubmits(80, 0)).toBe(80)
    expect(adjustedScoreFromSubmits(80, 1)).toBe(80)
  })

  it('applies multiplicative penalty for extra submits', () => {
    expect(adjustedScoreFromSubmits(100, 2)).toBe(98)
    expect(adjustedScoreFromSubmits(100, 3)).toBe(Math.round(100 * 0.98 * 0.98 * 100) / 100)
  })

  it('clamps raw percent', () => {
    expect(adjustedScoreFromSubmits(150, 1)).toBe(100)
    expect(adjustedScoreFromSubmits(-5, 2)).toBe(0)
  })
})

describe('prompt battle room resource guards', () => {
  beforeEach(() => {
    rooms.clear()
    promptRoomCreationAttempts.clear()
  })

  afterEach(() => {
    rooms.clear()
    promptRoomCreationAttempts.clear()
  })

  it('limits room creation attempts per authenticated user', () => {
    for (let i = 0; i < PROMPT_ROOM_CREATE_LIMIT; i++) {
      expect(checkPromptRoomCreationRate('limited-user', 10_000 + i).allowed).toBe(true)
    }

    const blocked = checkPromptRoomCreationRate('limited-user', 10_100)
    expect(blocked).toMatchObject({ allowed: false, reason: 'rate_limit' })
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('allows only one active room per user', () => {
    rooms.set('ACTIVE1', {
      status: 'running',
      players: new Map([['one-room-user', {}]])
    })

    expect(getPromptRoomAllocationStatus(['one-room-user'])).toMatchObject({
      allowed: false,
      reason: 'user_active_room',
      roomCode: 'ACTIVE1'
    })
  })

  it('hard-stops allocation at the global room capacity', () => {
    for (let i = 0; i < MAX_PROMPT_BATTLE_ROOMS; i++) {
      rooms.set(`ROOM${i}`, { status: 'running', players: new Map() })
    }

    expect(getPromptRoomAllocationStatus(['new-user'])).toMatchObject({
      allowed: false,
      reason: 'global_room_limit'
    })
  })

  it('prunes expired abandoned lobbies before allocating capacity', () => {
    rooms.set('EXPIRED', {
      status: 'lobby',
      lobbyExpiresAt: 999,
      players: new Map([['old-host', {}]])
    })

    expect(pruneExpiredPromptRooms(1000)).toBe(1)
    expect(rooms.has('EXPIRED')).toBe(false)
  })
})

describe('prompt battle matchmaking (socket.io)', () => {
  let httpServer
  let io
  let port

  beforeAll((done) => {
    httpServer = http.createServer()
    io = new Server(httpServer, { cors: { origin: '*' } })
    io.use((socket, next) => {
      const uid = socket.handshake.auth.testUserId
      if (uid == null) return next(new Error('test auth missing'))
      socket.userId = Number(uid)
      socket.username = `user${uid}`
      socket.join(`pb-player:${uid}`)
      next()
    })
    io.on('connection', (socket) => registerPromptBattleHandlers(socket, io))
    httpServer.listen(0, '127.0.0.1', () => {
      port = httpServer.address().port
      done()
    })
  })

  afterAll((done) => {
    try {
      io.disconnectSockets(true)
    } catch (_) {}
    io.close(() => {
      httpServer.close(() => done())
    })
  })

  function connectTestClient(testUserId) {
    const url = `http://127.0.0.1:${port}`
    return new Promise((resolve, reject) => {
      const socket = ioc(url, {
        auth: { testUserId },
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000
      })
      socket.on('connect', () => resolve(socket))
      socket.on('connect_error', reject)
    })
  }

  it('delivers pb-match-found to both players with the same roomCode', async () => {
    const c1 = await connectTestClient(90001)
    const c2 = await connectTestClient(90002)

    const got1 = new Promise((resolve) => {
      c1.once('pb-match-found', resolve)
    })
    const got2 = new Promise((resolve) => {
      c2.once('pb-match-found', resolve)
    })

    await new Promise((resolve, reject) => {
      c1.emit('pb-join-queue', { durationMinutes: 5 }, (r) => (r?.ok ? resolve() : reject(new Error(JSON.stringify(r)))))
    })
    await new Promise((resolve, reject) => {
      c2.emit('pb-join-queue', { durationMinutes: 5 }, (r) => (r?.ok ? resolve() : reject(new Error(JSON.stringify(r)))))
    })

    const [payload1, payload2] = await Promise.all([got1, got2])

    expect(payload1.roomCode).toBeTruthy()
    expect(payload1.roomCode).toBe(payload2.roomCode)
    expect(payload1.endsAt).toBe(payload2.endsAt)
    expect(payload1.problem).toEqual(payload2.problem)

    c1.close()
    c2.close()
  }, 15_000)

  it('sends private preview only to the submitting player', async () => {
    const c1 = await connectTestClient(91001)
    const c2 = await connectTestClient(91002)

    const got1 = new Promise((resolve) => {
      c1.once('pb-match-found', resolve)
    })
    const got2 = new Promise((resolve) => {
      c2.once('pb-match-found', resolve)
    })

    await new Promise((resolve, reject) => {
      c1.emit('pb-join-queue', { durationMinutes: 5 }, (r) => (r?.ok ? resolve() : reject(new Error(JSON.stringify(r)))))
    })
    await new Promise((resolve, reject) => {
      c2.emit('pb-join-queue', { durationMinutes: 5 }, (r) => (r?.ok ? resolve() : reject(new Error(JSON.stringify(r)))))
    })

    await Promise.all([got1, got2])

    let opponentGotPreview = false
    c2.on('pb-preview-ready', () => {
      opponentGotPreview = true
    })

    const previewStatus = new Promise((resolve) => {
      c1.once('pb-preview-status', resolve)
    })
    const previewReady = new Promise((resolve) => {
      c1.once('pb-preview-ready', resolve)
    })

    await new Promise((resolve, reject) => {
      c1.emit('pb-submit', { prompt: 'Draft a concise migration plan' }, (r) =>
        r?.ok ? resolve() : reject(new Error(JSON.stringify(r)))
      )
    })

    const statusPayload = await previewStatus
    const previewPayload = await previewReady

    expect(statusPayload.status).toBe('running')
    expect(previewPayload.modelOutput).toContain('Mock model output')
    expect(typeof previewPayload.scorePreview).toBe('number')

    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(opponentGotPreview).toBe(false)

    c1.close()
    c2.close()
  }, 15_000)
})
