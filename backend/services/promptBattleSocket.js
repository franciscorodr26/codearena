const logger = require('../utils/logger')
const promptEngineeringLoader = require('./promptEngineeringLoader')
const {
  runPlayerModel,
  countPromptTokens,
  getAvailablePromptBattleModels,
  getDefaultPromptBattleModelId,
  getModelQuotaCost,
  sanitizeModelId
} = require('./promptBattleRunner')
const { evaluateModelOutputTiered } = require('./promptModelOutputScore')
const db = require('../db')
const { getConsumerFairUseLimit } = require('../../shared/codearenaProductMode')

const rooms = new Map()

/** duration key "5"|"10"|"15" -> queue entries */
const promptBattleQueues = new Map()

const ALLOWED_DURATION_MIN = new Set([5, 10, 15])
const PREVIEW_ENABLED = process.env.PROMPT_BATTLE_PREVIEW_ENABLED !== 'false'

function getPositiveIntegerSetting(name, fallback) {
  const configured = Number.parseInt(process.env[name], 10)
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

const MAX_PROMPT_BATTLE_ROOMS = getPositiveIntegerSetting('CODEARENA_MAX_PROMPT_BATTLE_ROOMS', 2000)
const PROMPT_ROOM_CREATE_LIMIT = getPositiveIntegerSetting('CODEARENA_PROMPT_ROOM_CREATE_LIMIT_PER_MINUTE', 5)
const PROMPT_ROOM_CREATE_WINDOW_MS = 60 * 1000
const PROMPT_LOBBY_TTL_MS = getPositiveIntegerSetting('CODEARENA_PROMPT_LOBBY_TTL_MS', 15 * 60 * 1000)
const PROMPT_DONE_ROOM_TTL_MS = getPositiveIntegerSetting('CODEARENA_PROMPT_DONE_ROOM_TTL_MS', 10 * 60 * 1000)
const MAX_PROMPT_ROOM_RATE_BUCKETS = getPositiveIntegerSetting('CODEARENA_MAX_PROMPT_ROOM_RATE_BUCKETS', 10000)
const promptRoomCreationAttempts = new Map()

/** Flagged submissions (e.g. paste detected) get their adjusted score capped at this %. */
const PASTE_FLAG_SCORE_CAP = 20

async function consumePromptBattleModelQuota(userId, modelId) {
  const userLimit = getConsumerFairUseLimit('promptBattleModelCallsPerDay')
  const globalLimit = getConsumerFairUseLimit('globalPromptEvaluationsPerDay')
  const quota = await db.tryConsumeConsumerDailyUsage([
    { metric: 'prompt_battle_evaluation', subjectId: `user:${userId}`, limit: userLimit },
    // Pricier models use more of the shared daily budget.
    { metric: 'prompt_evaluation', subjectId: 'global', limit: globalLimit, amount: getModelQuotaCost(sanitizeModelId(modelId)) }
  ])
  if (!quota.allowed) {
    const error = new Error(quota.reason === 'global_limit'
      ? 'CodeArena has reached today\'s prompt capacity. Please try again tomorrow.'
      : `You've reached today's fair-use limit of ${userLimit} prompt-battle model runs. Try again tomorrow.`)
    error.code = quota.reason
    throw error
  }
}

function playerKeyFromSocket(socket) {
  if (socket.userId != null) return String(socket.userId)
  return null
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function clearPromptRoomTimers(room) {
  if (!room) return
  if (room.lobbyExpiryTimer) clearTimeout(room.lobbyExpiryTimer)
  if (room.timer) clearTimeout(room.timer)
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer)
  room.lobbyExpiryTimer = null
  room.timer = null
  room.cleanupTimer = null
}

function deletePromptBattleRoom(code, io) {
  const room = rooms.get(code)
  if (!room) return false
  clearPromptRoomTimers(room)
  try {
    io?.in(`pb-${code}`).socketsLeave(`pb-${code}`)
  } catch (err) {
    logger.debug('[prompt-battle] Could not clear expired socket room:', err.message)
  }
  return rooms.delete(code)
}

function pruneExpiredPromptRooms(now = Date.now(), io) {
  let removed = 0
  for (const [code, room] of rooms) {
    const expiredLobby = room.status === 'lobby' && room.lobbyExpiresAt != null && Number(room.lobbyExpiresAt) <= now
    const expiredDoneRoom = room.status === 'done' && room.cleanupAt != null && Number(room.cleanupAt) <= now
    if (expiredLobby || expiredDoneRoom) {
      deletePromptBattleRoom(code, io)
      removed++
    }
  }
  return removed
}

function checkPromptRoomCreationRate(playerKey, now = Date.now()) {
  const key = String(playerKey)
  const cutoff = now - PROMPT_ROOM_CREATE_WINDOW_MS
  const recent = (promptRoomCreationAttempts.get(key) || []).filter(timestamp => timestamp > cutoff)

  if (recent.length >= PROMPT_ROOM_CREATE_LIMIT) {
    promptRoomCreationAttempts.set(key, recent)
    return {
      allowed: false,
      reason: 'rate_limit',
      retryAfterMs: Math.max(1, recent[0] + PROMPT_ROOM_CREATE_WINDOW_MS - now)
    }
  }

  if (!promptRoomCreationAttempts.has(key) && promptRoomCreationAttempts.size >= MAX_PROMPT_ROOM_RATE_BUCKETS) {
    for (const [bucketKey, timestamps] of promptRoomCreationAttempts) {
      const active = timestamps.filter(timestamp => timestamp > cutoff)
      if (active.length > 0) promptRoomCreationAttempts.set(bucketKey, active)
      else promptRoomCreationAttempts.delete(bucketKey)
    }
    if (promptRoomCreationAttempts.size >= MAX_PROMPT_ROOM_RATE_BUCKETS) {
      return { allowed: false, reason: 'rate_capacity', retryAfterMs: PROMPT_ROOM_CREATE_WINDOW_MS }
    }
  }

  recent.push(now)
  promptRoomCreationAttempts.set(key, recent)
  return { allowed: true }
}

function getPromptRoomAllocationStatus(playerKeys, now = Date.now(), io) {
  pruneExpiredPromptRooms(now, io)
  for (const playerKey of playerKeys) {
    const roomCode = findRoomCodeByPlayerKey(playerKey)
    if (roomCode) return { allowed: false, reason: 'user_active_room', roomCode }
  }
  if (rooms.size >= MAX_PROMPT_BATTLE_ROOMS) {
    return { allowed: false, reason: 'global_room_limit' }
  }
  return { allowed: true }
}

function schedulePromptLobbyExpiry(code, io) {
  const room = rooms.get(code)
  if (!room || room.status !== 'lobby') return
  if (room.lobbyExpiryTimer) clearTimeout(room.lobbyExpiryTimer)
  room.lobbyExpiresAt = Date.now() + PROMPT_LOBBY_TTL_MS
  room.lobbyExpiryTimer = setTimeout(() => {
    const current = rooms.get(code)
    if (!current || current.status !== 'lobby') return
    io.to(`pb-${code}`).emit('pb-room-expired', { roomCode: code })
    deletePromptBattleRoom(code, io)
  }, PROMPT_LOBBY_TTL_MS)
  room.lobbyExpiryTimer.unref?.()
}

function findRoomCodeByPlayerKey(playerKey) {
  if (playerKey == null) return null
  const pk = String(playerKey)
  for (const [code, room] of rooms) {
    if (room.status !== 'done' && room.players.has(pk)) return code
  }
  return null
}

function removeUserFromPromptBattleQueue(playerKey) {
  if (playerKey == null) return null
  const uid = String(playerKey)
  let lastAffectedKey = null
  for (const [key, arr] of promptBattleQueues.entries()) {
    let i = arr.length
    while (i--) {
      if (String(arr[i].userId) === uid) {
        arr.splice(i, 1)
        lastAffectedKey = key
      }
    }
    if (arr.length === 0) promptBattleQueues.delete(key)
  }
  return lastAffectedKey
}

/** Keep queue entry socket id in sync when the same account reconnects (same tab). */
function refreshQueueSocketId(playerKey, socketId) {
  if (playerKey == null || !socketId) return
  const uid = String(playerKey)
  for (const arr of promptBattleQueues.values()) {
    for (const e of arr) {
      if (String(e.userId) === uid) e.socketId = socketId
    }
  }
}

/** ~2% effective score decay per extra submission after the first (multiplicative). */
function adjustedScoreFromSubmits(rawPercent, submitCount) {
  const raw = Math.max(0, Math.min(100, Number(rawPercent) || 0))
  const n = Math.max(0, Math.floor(Number(submitCount) || 0))
  if (n <= 1) return Math.round(raw * 100) / 100
  const factor = Math.pow(0.98, n - 1)
  return Math.round(raw * factor * 100) / 100
}

function roomSummary(room) {
  const players = []
  for (const [uid, p] of room.players) {
    players.push({
      userId: uid,
      username: p.username,
      submitted: p.submitted,
      submitCount: p.submitCount ?? 0,
      pasteDetected: !!p.pasteDetected,
      tabSwitchCount: p.tabSwitchCount ?? 0
    })
  }
  return {
    code: room.code,
    status: room.status,
    hostUserId: room.hostUserId,
    durationSec: room.durationSec,
    endsAt: room.endsAt || null,
    players,
    problem: room.problemPublic,
    difficulty: room.difficultyLabel || null,
    modelId: room.modelId || null,
    previewEnabled: PREVIEW_ENABLED
  }
}

function queueKey(durationMin, modelId) {
  return `${Number(durationMin) || 5}:${modelId || ''}`
}

function parseQueueKey(key) {
  const [durationRaw, modelId] = String(key || '').split(':')
  const durationMinutes = Number(durationRaw) || 5
  return { durationMinutes, modelId: modelId || null }
}

async function runPreviewForSubmission({ io, room, roomCode, playerKey, submissionVersion }) {
  if (!PREVIEW_ENABLED) return
  const p = room.players.get(playerKey)
  if (!p) return

  const promptText = p.prompt != null ? p.prompt : ''
  const promptHash = `${promptText.length}:${promptText.slice(0, 512)}`

  io.to(`pb-player:${String(playerKey)}`).emit('pb-preview-status', {
    roomCode,
    status: 'running',
    submissionVersion
  })

  try {
    await consumePromptBattleModelQuota(playerKey, room.modelId)
    const promptTokens = await countPromptTokens(room.problem, promptText, { modelId: room.modelId })
    const result = await runPlayerModel(room.problem, promptText, { modelId: room.modelId })
    const modelOutput = result.text
    const tokenUsage = {
      promptTokens,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens
    }
    const ev = evaluateModelOutputTiered(room.problem, modelOutput)

    const latest = room.players.get(playerKey)
    if (!latest || latest.submissionVersion !== submissionVersion || room.status !== 'running') {
      return
    }

    latest.previewCache = {
      promptHash,
      modelOutput,
      scorePercent: ev.scorePercent,
      tokenUsage,
      tierDetail: { tierResults: ev.tierResults, passedTierId: ev.passedTierId }
    }

    io.to(`pb-player:${String(playerKey)}`).emit('pb-preview-ready', {
      roomCode,
      submissionVersion,
      modelOutput,
      scorePreview: ev.scorePercent,
      tokenUsage,
      tierDetail: latest.previewCache.tierDetail
    })
  } catch (err) {
    const latest = room.players.get(playerKey)
    if (!latest || latest.submissionVersion !== submissionVersion || room.status !== 'running') {
      return
    }
    io.to(`pb-player:${String(playerKey)}`).emit('pb-preview-error', {
      roomCode,
      submissionVersion,
      message: err.message || 'Preview failed'
    })
  }
}

function broadcastQueueSizes(io, durationMin, modelId) {
  const key = queueKey(durationMin, modelId)
  const arr = promptBattleQueues.get(key) || []
  const waitingCount = arr.length
  for (const entry of arr) {
    const socket = io.sockets.sockets.get(entry.socketId)
    if (socket?.connected) {
      socket.emit('pb-queue-update', { durationMinutes: durationMin, modelId, waitingCount })
    }
  }
}

/**
 * @returns {Promise<boolean>} false if battle could not start (callers should re-queue players)
 */
async function startMatchedBattle(playerA, playerB, durationMin, io) {
  const modelId = sanitizeModelId(playerA.modelId || playerB.modelId)
  if (!modelId) {
    logger.error('[prompt-battle] No available model configured for match start')
    return { success: false }
  }
  const difficulty = promptEngineeringLoader.difficultyForDurationMinutes(durationMin)
  const problem =
    promptEngineeringLoader.getRandomByDifficulty(difficulty) || promptEngineeringLoader.getRandom()
  if (!problem) {
    logger.error('[prompt-battle] No problem available for difficulty', difficulty)
    return { success: false }
  }

  const capacity = getPromptRoomAllocationStatus([playerA.userId, playerB.userId], Date.now(), io)
  if (!capacity.allowed) {
    logger.warn(`[prompt-battle] Match start blocked: ${capacity.reason}`)
    return { success: false, reason: capacity.reason }
  }

  let code = genCode()
  let guard = 0
  while (rooms.has(code) && guard++ < 50) code = genCode()
  if (rooms.has(code)) {
    logger.error('[prompt-battle] Could not allocate room code')
    return { success: false }
  }

  const durationSec = durationMin * 60
  const problemPublic = promptEngineeringLoader.toPublicProblem(problem)

  const room = {
    code,
    hostUserId: playerA.userId,
    problem,
    problemPublic,
    durationSec,
    modelId,
    difficultyLabel: difficulty,
    startedAt: new Date().toISOString(),
    players: new Map([
      [
        playerA.userId,
        {
          username: playerA.username,
          socketId: playerA.socketId,
          prompt: null,
          submitted: false,
          submitCount: 0,
          submissionVersion: 0,
          previewCache: null,
          pasteDetected: false,
          tabSwitchCount: 0
        }
      ],
      [
        playerB.userId,
        {
          username: playerB.username,
          socketId: playerB.socketId,
          prompt: null,
          submitted: false,
          submitCount: 0,
          submissionVersion: 0,
          previewCache: null,
          pasteDetected: false,
          tabSwitchCount: 0
        }
      ]
    ]),
    status: 'running',
    endsAt: Date.now() + durationSec * 1000,
    timer: null,
    finalized: false
  }
  rooms.set(code, room)

  // Join every live connection for each player into the battle room (fixes stale queue socket ids).
  const battleRoom = `pb-${code}`
  try {
    await io.in(`pb-player:${String(playerA.userId)}`).socketsJoin(battleRoom)
    await io.in(`pb-player:${String(playerB.userId)}`).socketsJoin(battleRoom)
  } catch (err) {
    logger.error('[prompt-battle] socketsJoin failed:', err.message)
    deletePromptBattleRoom(code, io)
    return { success: false }
  }

  // Avoid a multi-minute open handle during Jest (integration tests only need match + scoring hooks off).
  if (typeof process.env.JEST_WORKER_ID === 'undefined') {
    room.timer = setTimeout(() => {
      finalizeRoom(code, io)
    }, durationSec * 1000)
  }

  const payloadBase = {
    roomCode: code,
    problem: problemPublic,
    endsAt: room.endsAt,
    durationSec,
    difficulty,
    modelId,
    players: [
      { userId: playerA.userId, username: playerA.username },
      { userId: playerB.userId, username: playerB.username }
    ],
    room: roomSummary(room)
  }

  io.to(battleRoom).emit('pb-match-found', payloadBase)

  logger.info(
    `[prompt-battle] Match ${code} ${difficulty} ${durationMin}min ${playerA.userId} vs ${playerB.userId}`
  )
  return { success: true, roomCode: code }
}

async function hasLiveConnection(io, playerKey, queuedSocketId) {
  const s = io.sockets.sockets.get(queuedSocketId)
  if (s?.connected) return true
  try {
    const socks = await io.in(`pb-player:${String(playerKey)}`).fetchSockets()
    return socks.length > 0
  } catch {
    return false
  }
}

async function tryPairBucket(durationMin, modelId, io) {
  const key = queueKey(durationMin, modelId)
  let arr = promptBattleQueues.get(key)
  if (!arr) return

  while (arr.length >= 2) {
    const a = arr.shift()
    const b = arr.shift()
    if (String(a.userId) === String(b.userId)) {
      arr.unshift(b)
      continue
    }
    const liveA = await hasLiveConnection(io, a.userId, a.socketId)
    const liveB = await hasLiveConnection(io, b.userId, b.socketId)
    if (!liveA || !liveB) {
      if (liveA) arr.unshift(a)
      if (liveB) arr.unshift(b)
      continue
    }
    const started = await startMatchedBattle(a, b, durationMin, io)
    if (!started?.success) {
      // A player can enter a private room while the async live-connection
      // checks above are in flight. Do not re-queue that now-ineligible user.
      if (started?.reason === 'user_active_room') {
        if (!findRoomCodeByPlayerKey(b.userId)) arr.unshift(b)
        if (!findRoomCodeByPlayerKey(a.userId)) arr.unshift(a)
      } else {
        arr.unshift(b)
        arr.unshift(a)
      }
      break
    }
    arr = promptBattleQueues.get(key)
    if (!arr) break
  }

  if (promptBattleQueues.get(key)?.length === 0) promptBattleQueues.delete(key)
  broadcastQueueSizes(io, durationMin, modelId)
}

/**
 * Persist battle results to the database
 */
async function persistBattleHistory(room, results, winnerUserId, tie) {
  try {
    // Get players from the room
    const playerEntries = Array.from(room.players.entries())
    if (playerEntries.length !== 2) {
      logger.warn('[prompt-battle] Cannot persist: expected 2 players, got', playerEntries.length)
      return
    }

    const [player1Id, player1Data] = playerEntries[0]
    const [player2Id, player2Data] = playerEntries[1]

    // Find results for each player
    const player1Result = results.find(r => String(r.userId) === String(player1Id)) || {}
    const player2Result = results.find(r => String(r.userId) === String(player2Id)) || {}

    await db.run(
      `INSERT INTO prompt_battle_history (
        room_code,
        player1_id, player1_username,
        player2_id, player2_username,
        problem_id, problem_title, difficulty, duration_sec,
        player1_prompt, player2_prompt,
        player1_score, player2_score,
        player1_adjusted_score, player2_adjusted_score,
        player1_submit_count, player2_submit_count,
        winner_id, is_tie,
        player1_model_output, player2_model_output,
        player1_token_usage, player2_token_usage,
        started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        room.code,
        player1Id,
        player1Data.username || 'Unknown',
        player2Id,
        player2Data.username || 'Unknown',
        room.problem?.id || room.problemPublic?.id || null,
        room.problem?.title || room.problemPublic?.title || null,
        room.difficultyLabel || null,
        room.durationSec,
        player1Data.prompt || null,
        player2Data.prompt || null,
        player1Result.scorePercent ?? null,
        player2Result.scorePercent ?? null,
        player1Result.adjustedScorePercent ?? null,
        player2Result.adjustedScorePercent ?? null,
        player1Result.submitCount ?? 0,
        player2Result.submitCount ?? 0,
        tie ? null : winnerUserId,
        tie ? 1 : 0,
        player1Result.modelOutput || null,
        player2Result.modelOutput || null,
        player1Result.tokenUsage ? JSON.stringify(player1Result.tokenUsage) : null,
        player2Result.tokenUsage ? JSON.stringify(player2Result.tokenUsage) : null,
        room.startedAt || null
      ]
    )

    logger.info(`[prompt-battle] Battle ${room.code} persisted to history`)
  } catch (err) {
    // Log but don't fail the battle finalization
    logger.error('[prompt-battle] Failed to persist battle history:', err.message)
  }
}

async function finalizeRoom(code, io) {
  const room = rooms.get(code)
  if (!room || room.finalized) return
  room.finalized = true
  room.status = 'scoring'
  if (room.lobbyExpiryTimer) clearTimeout(room.lobbyExpiryTimer)
  room.lobbyExpiryTimer = null
  if (room.timer) clearTimeout(room.timer)
  room.timer = null

  io.to(`pb-${code}`).emit('pb-scoring', { message: 'Running model and scoring...' })

  const results = []
  let winnerUserId = null
  let tie = false

  try {
    for (const [userId, p] of room.players) {
      const promptText = p.prompt != null ? p.prompt : ''
      const promptHash = `${promptText.length}:${promptText.slice(0, 512)}`
      let modelOutput = ''
      let scorePercent = 0
      let tierDetail = null
      let promptTokens = 0
      let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      try {
        if (p.previewCache && p.previewCache.promptHash === promptHash) {
          modelOutput = p.previewCache.modelOutput
          tokenUsage = p.previewCache.tokenUsage || tokenUsage
          scorePercent = p.previewCache.scorePercent || 0
          tierDetail = p.previewCache.tierDetail
        } else {
          await consumePromptBattleModelQuota(userId, room.modelId)
          promptTokens = await countPromptTokens(room.problem, promptText, { modelId: room.modelId })
          const result = await runPlayerModel(room.problem, promptText, { modelId: room.modelId })
          modelOutput = result.text
          tokenUsage = {
            promptTokens,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.totalTokens
          }
          const ev = evaluateModelOutputTiered(room.problem, modelOutput)
          scorePercent = ev.scorePercent
          tierDetail = ev
        }
      } catch (err) {
        logger.error(`[prompt-battle] Player ${userId} pipeline error:`, err.message)
        modelOutput = `[Model error: ${err.message}]`
        scorePercent = 0
      }
      const submitCount = Math.max(0, Math.floor(Number(p.submitCount) || 0))
      let adjustedScorePercent = adjustedScoreFromSubmits(scorePercent, submitCount)

      // Anti-cheat: flagged submissions (paste detected) have their ADJUSTED score capped here,
      // BEFORE winner/tie determination below. This mirrors solo-practice "hard-block paste"
      // parity: a flagged player's effective score is capped at PASTE_FLAG_SCORE_CAP rather than
      // auto-losing. (Accepted edge per arbiter ruling: a flagged player can still beat an opponent
      // who scored below the cap, since paste is hard-blocked client-side so the flag means
      // "blocked-paste attempt", not "successful cheat". See arbiter notes / debate ruling.)
      // Raw scorePercent is left intact for display (frontend shows raw vs adjusted).
      const pasteDetected = !!p.pasteDetected
      if (pasteDetected) {
        adjustedScorePercent = Math.min(adjustedScorePercent, PASTE_FLAG_SCORE_CAP)
      }

      results.push({
        userId,
        username: p.username,
        scorePercent,
        adjustedScorePercent,
        submitCount,
        pasteDetected,
        tabSwitchCount: p.tabSwitchCount ?? 0,
        promptCharCount: (p.prompt || '').length,
        tokenUsage,
        modelOutput,
        tierDetail: tierDetail
          ? { tierResults: tierDetail.tierResults, passedTierId: tierDetail.passedTierId }
          : null
      })
    }

    results.sort((a, b) => (b.adjustedScorePercent ?? b.scorePercent) - (a.adjustedScorePercent ?? a.scorePercent))
    winnerUserId = results.length ? results[0].userId : null
    tie =
      results.length === 2 &&
      (results[0].adjustedScorePercent ?? results[0].scorePercent) ===
        (results[1].adjustedScorePercent ?? results[1].scorePercent)

    room.status = 'done'
    room.results = {
      results,
      winnerUserId: tie ? null : winnerUserId,
      tie
    }
    io.to(`pb-${code}`).emit('pb-results', room.results)

    // Persist battle history to database (fire and forget, don't block)
    persistBattleHistory(room, results, winnerUserId, tie).catch(err => {
      logger.error('[prompt-battle] persistBattleHistory error:', err.message)
    })
  } catch (err) {
    logger.error('[prompt-battle] finalize error:', err)
    io.to(`pb-${code}`).emit('pb-error', { message: err.message || 'Scoring failed' })
  }

  room.cleanupAt = Date.now() + PROMPT_DONE_ROOM_TTL_MS
  room.cleanupTimer = setTimeout(() => deletePromptBattleRoom(code, io), PROMPT_DONE_ROOM_TTL_MS)
  room.cleanupTimer.unref?.()
}

function normalizeCode(c) {
  return String(c || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function registerPromptBattleHandlers(socket, io) {
  const pkConnect = playerKeyFromSocket(socket)
  if (pkConnect) refreshQueueSocketId(pkConnect, socket.id)

  // --- Private room flow (create / join / start) ---

  socket.on('pb-create', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const pk = playerKeyFromSocket(socket)
      if (!pk) return reply({ ok: false, error: 'Not authenticated' })

      const rate = checkPromptRoomCreationRate(pk)
      if (!rate.allowed) {
        return reply({
          ok: false,
          error: 'Too many room creation attempts. Please wait a moment.',
          code: rate.reason,
          retryAfter: Math.ceil((rate.retryAfterMs || 0) / 1000)
        })
      }

      const capacity = getPromptRoomAllocationStatus([pk], Date.now(), io)
      if (!capacity.allowed) {
        return reply({
          ok: false,
          error: capacity.reason === 'global_room_limit'
            ? 'Prompt battle rooms are at capacity. Please try again shortly.'
            : 'Finish or leave your current prompt battle before creating another.',
          code: capacity.reason
        })
      }

      let durationMin = Number(payload?.durationMinutes) || 5
      if (!ALLOWED_DURATION_MIN.has(durationMin)) durationMin = 5
      const modelId = sanitizeModelId(payload?.modelId)
      if (!modelId) return reply({ ok: false, error: 'No supported AI model is configured on server' })

      const problem = promptEngineeringLoader.getRandom()
      if (!problem) return reply({ ok: false, error: 'No problems available' })

      let code = genCode()
      let allocationAttempts = 0
      while (rooms.has(code) && allocationAttempts++ < 50) code = genCode()
      if (rooms.has(code)) return reply({ ok: false, error: 'Could not allocate room code' })

      const durationSec = durationMin * 60
      const problemPublic = promptEngineeringLoader.toPublicProblem(problem)

      const removedQueueKey = removeUserFromPromptBattleQueue(pk)
      if (removedQueueKey != null) {
        const parsed = parseQueueKey(removedQueueKey)
        broadcastQueueSizes(io, parsed.durationMinutes, parsed.modelId)
      }

      rooms.set(code, {
        code,
        hostUserId: pk,
        problem,
        problemPublic,
        durationSec,
        modelId,
        difficultyLabel: problem.difficulty || null,
        startedAt: null, // Will be set when battle starts
        players: new Map([
          [
            pk,
            {
              username: socket.username || `user_${pk}`,
              socketId: socket.id,
              prompt: null,
              submitted: false,
              submitCount: 0,
              submissionVersion: 0,
              previewCache: null,
              pasteDetected: false,
              tabSwitchCount: 0
            }
          ]
        ]),
        status: 'lobby',
        endsAt: null,
        timer: null,
        finalized: false
      })

      schedulePromptLobbyExpiry(code, io)

      socket.join(`pb-${code}`)
      logger.info(`[prompt-battle] Room ${code} created by ${pk}`)

      return reply({ ok: true, roomCode: code, room: roomSummary(rooms.get(code)) })
    } catch (err) {
      logger.error('[prompt-battle] pb-create:', err)
      return reply({ ok: false, error: err.message || 'Create failed' })
    }
  })

  socket.on('pb-join', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const pk = playerKeyFromSocket(socket)
      if (!pk) return reply({ ok: false, error: 'Not authenticated' })

      const code = normalizeCode(payload?.roomCode)
      const room = rooms.get(code)
      if (!room) return reply({ ok: false, error: 'Room not found' })
      if (room.status !== 'lobby') return reply({ ok: false, error: 'Match already started' })
      if (room.players.size >= 2 && !room.players.has(pk)) return reply({ ok: false, error: 'Room is full' })

      const existingRoomCode = findRoomCodeByPlayerKey(pk)
      if (existingRoomCode && existingRoomCode !== code) {
        return reply({ ok: false, error: 'Finish or leave your current prompt battle first.' })
      }

      if (room.players.has(pk)) {
        const p = room.players.get(pk)
        p.socketId = socket.id
        socket.join(`pb-${code}`)
        return reply({ ok: true, room: roomSummary(room) })
      }

      const removedQueueKey = removeUserFromPromptBattleQueue(pk)
      if (removedQueueKey != null) {
        const parsed = parseQueueKey(removedQueueKey)
        broadcastQueueSizes(io, parsed.durationMinutes, parsed.modelId)
      }

      room.players.set(pk, {
        username: socket.username || `user_${pk}`,
        socketId: socket.id,
        prompt: null,
        submitted: false,
        submitCount: 0,
        submissionVersion: 0,
        previewCache: null,
        pasteDetected: false,
        tabSwitchCount: 0
      })
      socket.join(`pb-${code}`)
      io.to(`pb-${code}`).emit('pb-room-update', roomSummary(room))
      logger.info(`[prompt-battle] ${pk} joined room ${code}`)

      return reply({ ok: true, room: roomSummary(room), previewEnabled: PREVIEW_ENABLED })
    } catch (err) {
      logger.error('[prompt-battle] pb-join:', err)
      return reply({ ok: false, error: err.message || 'Join failed' })
    }
  })

  socket.on('pb-start', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const pk = playerKeyFromSocket(socket)
      const code = findRoomCodeByPlayerKey(pk)
      if (!code) return reply({ ok: false, error: 'Not in a room' })

      const room = rooms.get(code)
      if (String(room.hostUserId) !== String(pk)) return reply({ ok: false, error: 'Only the host can start' })
      if (room.players.size < 2) return reply({ ok: false, error: 'Need two players' })
      if (room.status !== 'lobby') return reply({ ok: false, error: 'Already started' })

      room.status = 'running'
      room.endsAt = Date.now() + room.durationSec * 1000
      room.startedAt = new Date().toISOString()

      if (room.lobbyExpiryTimer) clearTimeout(room.lobbyExpiryTimer)
      room.lobbyExpiryTimer = null
      room.lobbyExpiresAt = null
      if (room.timer) clearTimeout(room.timer)
      room.timer = setTimeout(() => {
        finalizeRoom(code, io)
      }, room.durationSec * 1000)

      io.to(`pb-${code}`).emit('pb-started', {
        endsAt: room.endsAt,
        problem: room.problemPublic,
        durationSec: room.durationSec
      })

      return reply({ ok: true, room: roomSummary(room) })
    } catch (err) {
      logger.error('[prompt-battle] pb-start:', err)
      return reply({ ok: false, error: err.message || 'Start failed' })
    }
  })

  // --- Matchmaking queue flow ---

  socket.on('pb-join-queue', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const pk = playerKeyFromSocket(socket)
      if (!pk) {
        return reply({ ok: false, error: 'Not authenticated' })
      }

      if (findRoomCodeByPlayerKey(pk)) {
        return reply({ ok: false, error: 'Finish or leave your current prompt battle before matchmaking.' })
      }

      let durationMin = Number(payload?.durationMinutes) || 5
      if (!ALLOWED_DURATION_MIN.has(durationMin)) durationMin = 5
      const modelId = sanitizeModelId(payload?.modelId)
      if (!modelId) {
        return reply({ ok: false, error: 'No supported AI model is configured on server' })
      }

      removeUserFromPromptBattleQueue(pk)

      const key = queueKey(durationMin, modelId)
      if (!promptBattleQueues.has(key)) promptBattleQueues.set(key, [])
      promptBattleQueues.get(key).push({
        userId: pk,
        modelId,
        socketId: socket.id,
        username: socket.username || `user_${pk}`,
        queuedAt: Date.now()
      })

      void tryPairBucket(durationMin, modelId, io)

      const waiting = promptBattleQueues.get(key)?.length || 0
      const difficulty = promptEngineeringLoader.difficultyForDurationMinutes(durationMin)
      return reply({
        ok: true,
        durationMinutes: durationMin,
        modelId,
        waitingCount: waiting,
        difficulty
      })
    } catch (err) {
      logger.error('[prompt-battle] pb-join-queue:', err)
      return reply({ ok: false, error: err.message || 'Queue failed' })
    }
  })

  socket.on('pb-leave-queue', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const removedKey = removeUserFromPromptBattleQueue(playerKeyFromSocket(socket))
      if (removedKey != null) {
        const parsed = parseQueueKey(removedKey)
        broadcastQueueSizes(io, parsed.durationMinutes, parsed.modelId)
      }
      return reply({ ok: true })
    } catch (err) {
      logger.error('[prompt-battle] pb-leave-queue:', err)
      return reply({ ok: false, error: err.message })
    }
  })

  socket.on('pb-submit', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const pk = playerKeyFromSocket(socket)
      const code = findRoomCodeByPlayerKey(pk)
      if (!code) {
        return reply({ ok: false, error: 'Not in a battle' })
      }
      const room = rooms.get(code)
      if (room.status !== 'running') {
        return reply({ ok: false, error: 'Match is not running' })
      }
      if (Date.now() > room.endsAt) {
        return reply({ ok: false, error: 'Time is up' })
      }

      const raw = payload?.prompt
      const text = typeof raw === 'string' ? raw.slice(0, 12000) : ''
      const p = room.players.get(pk)
      if (!p) {
        return reply({ ok: false, error: 'Player not in room' })
      }

      // Anti-cheat flags. Sticky across submits: a clean re-submit cannot clear an earlier flag.
      const pasteDetected = !!payload?.pasteDetected
      const tabSwitchCount = Number.isFinite(payload?.tabSwitchCount)
        ? Math.max(0, Math.min(1000, Math.floor(payload.tabSwitchCount)))
        : 0
      p.pasteDetected = p.pasteDetected || pasteDetected
      p.tabSwitchCount = Math.max(p.tabSwitchCount || 0, tabSwitchCount)

      p.prompt = text
      p.submitCount = (p.submitCount || 0) + 1
      p.submissionVersion = (p.submissionVersion || 0) + 1
      p.previewCache = null
      p.submitted = true
      const submissionVersion = p.submissionVersion

      io.to(`pb-${code}`).emit('pb-room-update', roomSummary(room))
      void runPreviewForSubmission({
        io,
        room,
        roomCode: code,
        playerKey: pk,
        submissionVersion
      })

      return reply({ ok: true, room: roomSummary(room), previewEnabled: PREVIEW_ENABLED })
    } catch (err) {
      logger.error('[prompt-battle] pb-submit:', err)
      return reply({ ok: false, error: err.message || 'Submit failed' })
    }
  })

  socket.on('disconnect', () => {
    const removedKey = removeUserFromPromptBattleQueue(playerKeyFromSocket(socket))
    if (removedKey != null) {
      const parsed = parseQueueKey(removedKey)
      broadcastQueueSizes(io, parsed.durationMinutes, parsed.modelId)
    }
  })

  socket.emit('pb-config', {
    availableModels: getAvailablePromptBattleModels(),
    defaultModelId: getDefaultPromptBattleModelId(),
    previewEnabled: PREVIEW_ENABLED
  })

  socket.on('pb-get-config', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    return reply({
      ok: true,
      availableModels: getAvailablePromptBattleModels(),
      defaultModelId: getDefaultPromptBattleModelId(),
      previewEnabled: PREVIEW_ENABLED
    })
  })

  /** After Quick Match redirect: attach this socket to an in-progress prompt room you belong to. */
  socket.on('pb-rejoin-running-room', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {}
    try {
      const pk = playerKeyFromSocket(socket)
      if (!pk) return reply({ ok: false, error: 'Not authenticated' })
      const code = normalizeCode(payload?.roomCode)
      if (!code) return reply({ ok: false, error: 'roomCode required' })
      const room = rooms.get(code)
      if (!room) return reply({ ok: false, error: 'Room not found' })
      if (!room.players.has(pk)) return reply({ ok: false, error: 'You are not in this battle' })
      if (room.status !== 'running' && room.status !== 'scoring' && !(room.status === 'done' && room.results)) {
        return reply({ ok: false, error: 'Battle is not active' })
      }
      const p = room.players.get(pk)
      p.socketId = socket.id
      socket.join(`pb-${code}`)
      return reply({
        ok: true,
        roomCode: code,
        room: roomSummary(room),
        endsAt: room.endsAt,
        durationSec: room.durationSec,
        difficulty: room.difficultyLabel,
        modelId: room.modelId,
        problem: room.problemPublic,
        phase: room.status === 'done' ? 'results' : room.status === 'scoring' ? 'scoring' : 'playing',
        ...(room.status === 'done' ? { results: room.results } : {})
      })
    } catch (err) {
      logger.error('[prompt-battle] pb-rejoin-running-room:', err)
      return reply({ ok: false, error: err.message || 'Rejoin failed' })
    }
  })
}

module.exports = {
  registerPromptBattleHandlers,
  adjustedScoreFromSubmits,
  startMatchedBattle,
  removeUserFromPromptBattleQueue,
  // Test-only exports (added by tester to verify paste-flag cap path; not used by production code).
  finalizeRoom,
  rooms,
  promptRoomCreationAttempts,
  checkPromptRoomCreationRate,
  getPromptRoomAllocationStatus,
  pruneExpiredPromptRooms,
  deletePromptBattleRoom,
  MAX_PROMPT_BATTLE_ROOMS,
  PROMPT_ROOM_CREATE_LIMIT
}
