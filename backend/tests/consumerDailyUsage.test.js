const path = require('path')
const fs = require('fs')
const os = require('os')

const TEST_DB_PATH = path.join(os.tmpdir(), `codearena-consumer-usage-${Date.now()}-${process.pid}.sqlite`)
process.env.DB_PATH = TEST_DB_PATH

const db = require('../db')

describe('consumer daily usage', () => {
  beforeAll(async () => {
    await db.init()
  })

  beforeEach(async () => {
    await db.run('DELETE FROM consumer_daily_usage')
  })

  afterAll(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(`${TEST_DB_PATH}${suffix}`)
      } catch (_) {}
    }
  })

  it('atomically consumes user and global capacity', async () => {
    const resources = [
      { metric: 'practice_execution', subjectId: 'user:7', limit: 2 },
      { metric: 'code_execution', subjectId: 'global', limit: 3 }
    ]

    const first = await db.tryConsumeConsumerDailyUsage(resources)
    const second = await db.tryConsumeConsumerDailyUsage(resources)
    const blocked = await db.tryConsumeConsumerDailyUsage(resources)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(blocked).toMatchObject({ allowed: false, reason: 'user_limit' })
    expect(await db.getConsumerDailyUsage('practice_execution', 'user:7')).toBe(2)
    expect(await db.getConsumerDailyUsage('code_execution', 'global')).toBe(2)
  })

  it('charges a weighted use its full amount and refuses one that would overrun the limit', async () => {
    const heavy = [
      { metric: 'prompt_battle_evaluation', subjectId: 'user:5', limit: 10 },
      { metric: 'prompt_evaluation', subjectId: 'global', limit: 12, amount: 5 }
    ]
    expect((await db.tryConsumeConsumerDailyUsage(heavy)).allowed).toBe(true)
    expect((await db.tryConsumeConsumerDailyUsage(heavy)).allowed).toBe(true)
    // 10 of 12 used: another 5 would overrun, even though 2 units remain.
    expect(await db.tryConsumeConsumerDailyUsage(heavy)).toMatchObject({ allowed: false, reason: 'global_limit' })
    expect(await db.getConsumerDailyUsage('prompt_evaluation', 'global')).toBe(10)
    // The per-player count moves by one per use, and not at all when refused.
    expect(await db.getConsumerDailyUsage('prompt_battle_evaluation', 'user:5')).toBe(2)
    // A light use still fits in the remaining 2.
    const light = await db.tryConsumeConsumerDailyUsage([
      { metric: 'prompt_evaluation', subjectId: 'global', limit: 12 }
    ])
    expect(light).toMatchObject({ allowed: true })
    expect(light.usage[0]).toMatchObject({ used: 11, remaining: 1 })
  })

  it('does not consume a user allowance when the global circuit breaker is exhausted', async () => {
    await db.tryConsumeConsumerDailyUsage([
      { metric: 'prompt_evaluation', subjectId: 'global', limit: 1 }
    ])

    const result = await db.tryConsumeConsumerDailyUsage([
      { metric: 'prompt_practice_evaluation', subjectId: 'user:9', limit: 3 },
      { metric: 'prompt_evaluation', subjectId: 'global', limit: 1 }
    ])

    expect(result).toMatchObject({ allowed: false, reason: 'global_limit' })
    expect(await db.getConsumerDailyUsage('prompt_practice_evaluation', 'user:9')).toBe(0)
  })
})
