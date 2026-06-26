/**
 * Adversarial tests for the paste / anti-cheat flag feature in promptBattleSocket.
 *
 * Covers:
 *  - pasteDetected coercion + tabSwitchCount clamping (pb-submit sanitization)
 *  - stickiness across submits (flag survives clean re-submit; tabSwitchCount = max)
 *  - score cap in finalizeRoom (adjusted capped at 20, raw preserved, flagged loses to clean,
 *    both-flagged tie)
 *  - roomSummary carries the new fields
 *  - defensive edge cases via internal-state mutation (missing fields, null adjusted path)
 *
 * NOTE: finalizeRoom and rooms are TEST-ONLY exports added to the module to make the
 * cap/winner/tie path reachable. There is no socket event that triggers finalizeRoom and
 * the real timer is disabled under Jest, so without the export the core feature is
 * untestable in isolation. Flagged in the tester report.
 *
 * The mock evaluateModelOutputTiered returns scorePercent:77 for EVERY submission, which is
 * what makes the cap visibly "bite" (77 -> 20).
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
// db.run is fire-and-forget inside finalize; stub it so persistence never touches sqlite.
jest.mock('../db', () => ({
  run: jest.fn(async () => ({})),
  tryConsumeConsumerDailyUsage: jest.fn(async (resources) => ({
    allowed: true,
    usage: resources.map(resource => ({ ...resource, used: 1, remaining: resource.limit - 1 }))
  }))
}))

const {
  registerPromptBattleHandlers,
  finalizeRoom,
  rooms
} = require('../services/promptBattleSocket')

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

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (r) => (r?.ok ? resolve(r) : reject(new Error(JSON.stringify(r)))))
  })
}

/** Queue two users, wait for both pb-match-found, return { c1, c2, roomCode }. */
async function startMatch(uidA, uidB) {
  const c1 = await connectTestClient(uidA)
  const c2 = await connectTestClient(uidB)
  const got1 = new Promise((resolve) => c1.once('pb-match-found', resolve))
  const got2 = new Promise((resolve) => c2.once('pb-match-found', resolve))
  await emitAck(c1, 'pb-join-queue', { durationMinutes: 5 })
  await emitAck(c2, 'pb-join-queue', { durationMinutes: 5 })
  const [p1] = await Promise.all([got1, got2])
  return { c1, c2, roomCode: p1.roomCode }
}

function meIn(roomPayload, uid) {
  return roomPayload.players.find((pl) => String(pl.userId) === String(uid))
}

// ---------------------------------------------------------------------------
// 1. SANITIZATION — pasteDetected coercion + tabSwitchCount clamping
// ---------------------------------------------------------------------------
describe('pb-submit sanitization', () => {
  it('coerces pasteDetected: truthy values -> true', async () => {
    const { c1, c2 } = await startMatch(20001, 20002)
    const r = await emitAck(c1, 'pb-submit', { prompt: 'x', pasteDetected: 'yes-string' })
    expect(meIn(r.room, 20001).pasteDetected).toBe(true)
    c1.close(); c2.close()
  }, 15000)

  it('coerces pasteDetected: falsy/missing -> false', async () => {
    const { c1, c2 } = await startMatch(20003, 20004)
    const rMissing = await emitAck(c1, 'pb-submit', { prompt: 'x' })
    expect(meIn(rMissing.room, 20003).pasteDetected).toBe(false)
    const rZero = await emitAck(c2, 'pb-submit', { prompt: 'x', pasteDetected: 0 })
    expect(meIn(rZero.room, 20004).pasteDetected).toBe(false)
    c1.close(); c2.close()
  }, 15000)

  it('clamps tabSwitchCount: negative -> 0', async () => {
    const { c1, c2 } = await startMatch(20005, 20006)
    const r = await emitAck(c1, 'pb-submit', { prompt: 'x', tabSwitchCount: -50 })
    expect(meIn(r.room, 20005).tabSwitchCount).toBe(0)
    c1.close(); c2.close()
  }, 15000)

  it('clamps tabSwitchCount: >1000 -> 1000', async () => {
    const { c1, c2 } = await startMatch(20007, 20008)
    const r = await emitAck(c1, 'pb-submit', { prompt: 'x', tabSwitchCount: 99999 })
    expect(meIn(r.room, 20007).tabSwitchCount).toBe(1000)
    c1.close(); c2.close()
  }, 15000)

  it('floors a float tabSwitchCount', async () => {
    const { c1, c2 } = await startMatch(20009, 20010)
    const r = await emitAck(c1, 'pb-submit', { prompt: 'x', tabSwitchCount: 7.9 })
    expect(meIn(r.room, 20009).tabSwitchCount).toBe(7)
    c1.close(); c2.close()
  }, 15000)

  it('non-finite tabSwitchCount (NaN / string / undefined) -> 0', async () => {
    // Number.isFinite is false for numeric strings, so "5" -> 0 (documented behavior).
    const { c1, c2 } = await startMatch(20011, 20012)
    const rStr = await emitAck(c1, 'pb-submit', { prompt: 'x', tabSwitchCount: '5' })
    expect(meIn(rStr.room, 20011).tabSwitchCount).toBe(0)
    const rNaN = await emitAck(c2, 'pb-submit', { prompt: 'x', tabSwitchCount: NaN })
    expect(meIn(rNaN.room, 20012).tabSwitchCount).toBe(0)
    c1.close(); c2.close()
  }, 15000)

  it('non-numeric-string tabSwitchCount "abc" -> 0', async () => {
    const { c1, c2 } = await startMatch(20013, 20014)
    const r = await emitAck(c1, 'pb-submit', { prompt: 'x', tabSwitchCount: 'abc' })
    expect(meIn(r.room, 20013).tabSwitchCount).toBe(0)
    c1.close(); c2.close()
  }, 15000)
})

// ---------------------------------------------------------------------------
// 2. STICKINESS across submits
// ---------------------------------------------------------------------------
describe('pb-submit stickiness', () => {
  it('paste flag from submit#1 survives a clean submit#2', async () => {
    const { c1, c2 } = await startMatch(21001, 21002)
    const r1 = await emitAck(c1, 'pb-submit', { prompt: 'first', pasteDetected: true })
    expect(meIn(r1.room, 21001).pasteDetected).toBe(true)
    const r2 = await emitAck(c1, 'pb-submit', { prompt: 'second clean', pasteDetected: false })
    expect(meIn(r2.room, 21001).pasteDetected).toBe(true) // sticky
    c1.close(); c2.close()
  }, 15000)

  it('tabSwitchCount takes the max across submits and never decreases', async () => {
    const { c1, c2 } = await startMatch(21003, 21004)
    const r1 = await emitAck(c1, 'pb-submit', { prompt: 'a', tabSwitchCount: 8 })
    expect(meIn(r1.room, 21003).tabSwitchCount).toBe(8)
    const r2 = await emitAck(c1, 'pb-submit', { prompt: 'b', tabSwitchCount: 3 })
    expect(meIn(r2.room, 21003).tabSwitchCount).toBe(8) // did not drop to 3
    const r3 = await emitAck(c1, 'pb-submit', { prompt: 'c', tabSwitchCount: 20 })
    expect(meIn(r3.room, 21003).tabSwitchCount).toBe(20) // climbs
    c1.close(); c2.close()
  }, 15000)
})

// ---------------------------------------------------------------------------
// 3. SCORE CAP in finalizeRoom (core feature)
// ---------------------------------------------------------------------------
describe('finalizeRoom paste-flag score cap', () => {
  function waitResults(socket) {
    return new Promise((resolve) => socket.once('pb-results', resolve))
  }

  it('caps a flagged player adjusted score at 20, preserves raw, flagged LOSES to clean', async () => {
    const { c1, c2, roomCode } = await startMatch(22001, 22002)
    // c1 flagged, c2 clean. Both score raw 77 via mock.
    await emitAck(c1, 'pb-submit', { prompt: 'flagged prompt', pasteDetected: true })
    await emitAck(c2, 'pb-submit', { prompt: 'clean prompt' })

    const results1 = waitResults(c1)
    await finalizeRoom(roomCode, io)
    const payload = await results1

    const flagged = payload.results.find((r) => String(r.userId) === '22001')
    const clean = payload.results.find((r) => String(r.userId) === '22002')

    expect(flagged.scorePercent).toBe(77) // raw untouched
    expect(flagged.adjustedScorePercent).toBe(20) // capped
    expect(flagged.pasteDetected).toBe(true)
    expect(clean.scorePercent).toBe(77)
    expect(clean.adjustedScorePercent).toBe(77)

    expect(payload.tie).toBe(false)
    expect(String(payload.winnerUserId)).toBe('22002') // clean wins
    // results sorted desc by adjusted -> clean first
    expect(String(payload.results[0].userId)).toBe('22002')

    c1.close(); c2.close()
  }, 15000)

  it('both players flagged -> both capped to 20 -> tie', async () => {
    const { c1, c2, roomCode } = await startMatch(22003, 22004)
    await emitAck(c1, 'pb-submit', { prompt: 'p1', pasteDetected: true })
    await emitAck(c2, 'pb-submit', { prompt: 'p2', pasteDetected: true })

    const results1 = waitResults(c1)
    await finalizeRoom(roomCode, io)
    const payload = await results1

    const r1 = payload.results.find((r) => String(r.userId) === '22003')
    const r2 = payload.results.find((r) => String(r.userId) === '22004')
    expect(r1.adjustedScorePercent).toBe(20)
    expect(r2.adjustedScorePercent).toBe(20)
    expect(payload.tie).toBe(true)
    expect(payload.winnerUserId).toBeNull()

    c1.close(); c2.close()
  }, 15000)

  it('flagged player with sticky flag (set on submit#1, clean submit#2) still capped at finalize', async () => {
    const { c1, c2, roomCode } = await startMatch(22005, 22006)
    await emitAck(c1, 'pb-submit', { prompt: 'first', pasteDetected: true })
    await emitAck(c1, 'pb-submit', { prompt: 'second clean', pasteDetected: false })
    await emitAck(c2, 'pb-submit', { prompt: 'clean' })

    const results1 = waitResults(c1)
    await finalizeRoom(roomCode, io)
    const payload = await results1

    const flagged = payload.results.find((r) => String(r.userId) === '22005')
    expect(flagged.pasteDetected).toBe(true)
    expect(flagged.adjustedScorePercent).toBe(20)
    expect(String(payload.winnerUserId)).toBe('22006')

    c1.close(); c2.close()
  }, 15000)
})

// ---------------------------------------------------------------------------
// 4. roomSummary includes new fields
// ---------------------------------------------------------------------------
describe('roomSummary new fields', () => {
  it('pb-submit ack room.players carry pasteDetected + tabSwitchCount for every player', async () => {
    const { c1, c2 } = await startMatch(23001, 23002)
    const r = await emitAck(c1, 'pb-submit', { prompt: 'x', pasteDetected: true, tabSwitchCount: 4 })
    for (const pl of r.room.players) {
      expect(pl).toHaveProperty('pasteDetected')
      expect(pl).toHaveProperty('tabSwitchCount')
    }
    expect(meIn(r.room, 23001)).toMatchObject({ pasteDetected: true, tabSwitchCount: 4 })
    // opponent who never submitted still has defaults
    expect(meIn(r.room, 23002)).toMatchObject({ pasteDetected: false, tabSwitchCount: 0 })
    c1.close(); c2.close()
  }, 15000)
})

// ---------------------------------------------------------------------------
// 5. DEFENSIVE EDGE CASES via internal-state mutation
//    (Not reachable through the real flow because all 4 init sites default the
//    fields; we mutate room internals to exercise the Math.max/Math.min/?? guards.)
// ---------------------------------------------------------------------------
describe('finalizeRoom defensive guards (internal mutation)', () => {
  function waitResults(socket) {
    return new Promise((resolve) => socket.once('pb-results', resolve))
  }

  it('old in-flight room missing pasteDetected/tabSwitchCount -> no NaN / no crash', async () => {
    const { c1, c2, roomCode } = await startMatch(24001, 24002)
    await emitAck(c1, 'pb-submit', { prompt: 'a' })
    await emitAck(c2, 'pb-submit', { prompt: 'b' })

    // Simulate a pre-feature room: delete the fields off both player objects.
    const room = rooms.get(roomCode)
    for (const p of room.players.values()) {
      delete p.pasteDetected
      delete p.tabSwitchCount
    }

    const results1 = waitResults(c1)
    await finalizeRoom(roomCode, io)
    const payload = await results1

    for (const r of payload.results) {
      expect(Number.isNaN(r.adjustedScorePercent)).toBe(false)
      expect(Number.isNaN(r.tabSwitchCount)).toBe(false)
      expect(r.tabSwitchCount).toBe(0) // ?? 0 fallback
      expect(r.pasteDetected).toBe(false) // !! undefined
      expect(r.adjustedScorePercent).toBe(77) // not flagged -> uncapped
    }
    expect(payload.tie).toBe(true) // both 77
    c1.close(); c2.close()
  }, 15000)
})
