const ACTIVE_BOT_STATES = new Set(['waiting', 'ready', 'coding'])

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getHumanUserId(battle) {
  const human = battle?.players?.find(player => !player.isBot)
  return human?.userId == null ? null : String(human.userId)
}

function isActiveBotBattle(battle) {
  return battle?.isAgainstBot === true && ACTIVE_BOT_STATES.has(battle.state)
}

function createBotBattleGuard(environment = process.env) {
  const requestWindowMs = 60 * 1000
  const startWindowMs = 60 * 1000
  const requestLimit = readPositiveInteger(environment.CODEARENA_BOT_BATTLE_REQUESTS_PER_MINUTE, 6)
  const startLimit = readPositiveInteger(environment.CODEARENA_BOT_BATTLE_STARTS_PER_MINUTE, 6)
  const perUserActiveLimit = readPositiveInteger(environment.CODEARENA_MAX_ACTIVE_BOT_BATTLES_PER_USER, 1)
  const globalActiveLimit = readPositiveInteger(environment.CODEARENA_MAX_ACTIVE_BOT_BATTLES, 500)
  const maxLifetimeMs = readPositiveInteger(environment.CODEARENA_BOT_BATTLE_MAX_LIFETIME_MINUTES, 20) * 60 * 1000

  const requestsByUser = new Map()
  const startsByUser = new Map()
  const authorizedStarts = new Map()

  function consumeWindow(log, userId, limit, windowMs, now) {
    if (userId == null) {
      return { allowed: false, reason: 'authentication_required', retryAfterMs: 0 }
    }

    const key = String(userId)
    const cutoff = now - windowMs
    const recent = (log.get(key) || []).filter(timestamp => timestamp > cutoff)
    if (recent.length >= limit) {
      log.set(key, recent)
      return {
        allowed: false,
        reason: 'rate_limit',
        retryAfterMs: Math.max(1, recent[0] + windowMs - now)
      }
    }

    recent.push(now)
    log.set(key, recent)
    return { allowed: true, remaining: Math.max(0, limit - recent.length) }
  }

  function cleanupRateLimitState(now) {
    const pruneLog = (log, windowMs) => {
      for (const [userId, timestamps] of log) {
        const recent = timestamps.filter(timestamp => timestamp > now - windowMs)
        if (recent.length > 0) log.set(userId, recent)
        else log.delete(userId)
      }
    }

    pruneLog(requestsByUser, requestWindowMs)
    pruneLog(startsByUser, startWindowMs)
    for (const [battleId, expiresAt] of authorizedStarts) {
      if (expiresAt <= now) authorizedStarts.delete(battleId)
    }
  }

  function checkRequest(userId, now = Date.now()) {
    cleanupRateLimitState(now)
    return consumeWindow(requestsByUser, userId, requestLimit, requestWindowMs, now)
  }

  function checkStart(userId, battleId, now = Date.now()) {
    cleanupRateLimitState(now)
    if (!battleId) return { allowed: false, reason: 'invalid_battle', retryAfterMs: 0 }
    if (authorizedStarts.has(String(battleId))) {
      return { allowed: true, alreadyAuthorized: true }
    }

    const result = consumeWindow(startsByUser, userId, startLimit, startWindowMs, now)
    if (result.allowed) {
      authorizedStarts.set(String(battleId), now + maxLifetimeMs)
    }
    return result
  }

  function pruneExpiredBattles(battles, now = Date.now(), onEvict = null) {
    let removed = 0
    for (const [battleId, battle] of battles) {
      if (!isActiveBotBattle(battle)) continue
      const createdAt = Number(battle.createdAt) || 0
      if (createdAt > 0 && now - createdAt <= maxLifetimeMs) continue

      if (battle.botSubmitTimeout) {
        clearTimeout(battle.botSubmitTimeout)
        battle.botSubmitTimeout = null
      }
      battles.delete(battleId)
      authorizedStarts.delete(String(battleId))
      removed++
      if (typeof onEvict === 'function') onEvict(battleId, battle)
    }
    cleanupRateLimitState(now)
    return removed
  }

  function canCreate(userId, battles, now = Date.now(), onEvict = null) {
    if (userId == null) return { allowed: false, reason: 'authentication_required' }
    pruneExpiredBattles(battles, now, onEvict)

    let globalActive = 0
    let userActive = 0
    const normalizedUserId = String(userId)
    for (const battle of battles.values()) {
      if (!isActiveBotBattle(battle)) continue
      globalActive++
      if (getHumanUserId(battle) === normalizedUserId) userActive++
    }

    if (userActive >= perUserActiveLimit) {
      return { allowed: false, reason: 'user_active_limit', active: userActive, limit: perUserActiveLimit }
    }
    if (globalActive >= globalActiveLimit) {
      return { allowed: false, reason: 'global_active_limit', active: globalActive, limit: globalActiveLimit }
    }
    return { allowed: true, userActive, globalActive }
  }

  return {
    checkRequest,
    checkStart,
    canCreate,
    pruneExpiredBattles,
    isActiveBotBattle,
    limits: Object.freeze({
      requestLimit,
      startLimit,
      perUserActiveLimit,
      globalActiveLimit,
      maxLifetimeMs
    })
  }
}

module.exports = {
  ACTIVE_BOT_STATES,
  createBotBattleGuard,
  getHumanUserId,
  isActiveBotBattle,
  readPositiveInteger
}
