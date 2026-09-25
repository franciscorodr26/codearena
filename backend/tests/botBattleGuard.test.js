const { createBotBattleGuard } = require('../services/botBattleGuard')

function botBattle(id, userId, overrides = {}) {
  return {
    id,
    isAgainstBot: true,
    state: 'waiting',
    createdAt: 1_000,
    players: [
      { id: `human-${id}`, userId, isBot: false },
      { id: `bot-${id}`, userId: null, isBot: true }
    ],
    ...overrides
  }
}

describe('bot battle guard', () => {
  it('requires an authenticated user and rate limits requests by user, not socket', () => {
    const guard = createBotBattleGuard({
      CODEARENA_BOT_BATTLE_REQUESTS_PER_MINUTE: '2'
    })

    expect(guard.checkRequest(null, 1_000)).toMatchObject({
      allowed: false,
      reason: 'authentication_required'
    })
    expect(guard.checkRequest(7, 1_000).allowed).toBe(true)
    expect(guard.checkRequest('7', 1_001).allowed).toBe(true)
    expect(guard.checkRequest(7, 1_002)).toMatchObject({
      allowed: false,
      reason: 'rate_limit'
    })
    expect(guard.checkRequest(7, 61_001).allowed).toBe(true)
  })

  it('limits unique battle starts while allowing harmless duplicate lifecycle events', () => {
    const guard = createBotBattleGuard({
      CODEARENA_BOT_BATTLE_STARTS_PER_MINUTE: '2'
    })

    expect(guard.checkStart(9, 'battle-1', 1_000).allowed).toBe(true)
    expect(guard.checkStart(9, 'battle-1', 1_001)).toMatchObject({
      allowed: true,
      alreadyAuthorized: true
    })
    expect(guard.checkStart(9, 'battle-2', 1_002).allowed).toBe(true)
    expect(guard.checkStart(9, 'battle-3', 1_003)).toMatchObject({
      allowed: false,
      reason: 'rate_limit'
    })
  })

  it('enforces per-user and global active battle caps', () => {
    const perUserGuard = createBotBattleGuard({
      CODEARENA_MAX_ACTIVE_BOT_BATTLES_PER_USER: '1',
      CODEARENA_MAX_ACTIVE_BOT_BATTLES: '5'
    })
    const perUserBattles = new Map([
      ['battle-1', botBattle('battle-1', 1)]
    ])
    expect(perUserGuard.canCreate(1, perUserBattles, 2_000)).toMatchObject({
      allowed: false,
      reason: 'user_active_limit'
    })
    expect(perUserGuard.canCreate(2, perUserBattles, 2_000).allowed).toBe(true)

    const globalGuard = createBotBattleGuard({
      CODEARENA_MAX_ACTIVE_BOT_BATTLES_PER_USER: '2',
      CODEARENA_MAX_ACTIVE_BOT_BATTLES: '2'
    })
    const globalBattles = new Map([
      ['battle-1', botBattle('battle-1', 1)],
      ['battle-2', botBattle('battle-2', 2)]
    ])
    expect(globalGuard.canCreate(3, globalBattles, 2_000)).toMatchObject({
      allowed: false,
      reason: 'global_active_limit'
    })
  })

  it('expires abandoned bot battles before capacity checks and clears their timers', () => {
    jest.useFakeTimers()
    try {
      const guard = createBotBattleGuard({
        CODEARENA_BOT_BATTLE_MAX_LIFETIME_MINUTES: '1',
        CODEARENA_MAX_ACTIVE_BOT_BATTLES_PER_USER: '1'
      })
      const timeout = setTimeout(() => {}, 100_000)
      const expired = botBattle('expired', 4, { botSubmitTimeout: timeout })
      const battles = new Map([['expired', expired]])
      const onEvict = jest.fn()

      expect(guard.canCreate(4, battles, 62_000, onEvict).allowed).toBe(true)
      expect(battles.has('expired')).toBe(false)
      expect(expired.botSubmitTimeout).toBeNull()
      expect(onEvict).toHaveBeenCalledWith('expired', expired)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not count finished or human battles against bot capacity', () => {
    const guard = createBotBattleGuard({
      CODEARENA_MAX_ACTIVE_BOT_BATTLES: '1'
    })
    const battles = new Map([
      ['finished', botBattle('finished', 1, { state: 'finished' })],
      ['human', { ...botBattle('human', 2), isAgainstBot: false }]
    ])

    expect(guard.canCreate(3, battles, 2_000).allowed).toBe(true)
  })
})
