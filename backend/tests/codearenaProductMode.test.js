const {
  CODEARENA_PRODUCT_MODE,
  getConsumerFairUseLimit,
  getConsumerQuotaStatus
} = require('../../shared/codearenaProductMode')

describe('CodeArena consumer product mode', () => {
  it('keeps the hosted consumer product free with its core surfaces enabled', () => {
    expect(CODEARENA_PRODUCT_MODE.consumer).toMatchObject({
      accessModel: 'free',
      paidSubscriptionsEnabled: false,
      coreFeatures: {
        battles: true,
        matchmaking: true,
        problems: true,
        leaderboards: true,
        practice: true
      }
    })
  })

  it('applies fair-use quotas even to legacy Pro accounts when paid plans are disabled', () => {
    expect(getConsumerQuotaStatus(2, 3, true)).toEqual({
      allowed: true,
      remaining: 1,
      limit: 3,
      isPro: false,
      accessModel: 'free'
    })
    expect(getConsumerQuotaStatus(3, 3, true)).toEqual({
      allowed: false,
      remaining: 0,
      limit: 3,
      isPro: false,
      accessModel: 'free'
    })
  })

  it('keeps optional high-cost AI practice surfaces disabled at launch', () => {
    expect(CODEARENA_PRODUCT_MODE.consumer.optionalFeatures).toEqual({
      aiCoach: false,
      aiInterviews: false,
      voiceInterviews: false
    })
  })

  it('uses growth-friendly defaults with positive environment overrides', () => {
    expect(getConsumerFairUseLimit('practiceRunsPerDay', {})).toBe(25)
    expect(getConsumerFairUseLimit('battleCodeExecutionsPerDay', {})).toBe(50)
    expect(getConsumerFairUseLimit('botBattlesPerDay', {})).toBe(20)
    expect(getConsumerFairUseLimit('promptPracticeAttemptsPerDay', {})).toBe(3)
    expect(getConsumerFairUseLimit('dailyChallengePromptEvaluationsPerDay', {})).toBe(3)
    expect(getConsumerFairUseLimit('promptBattleModelCallsPerDay', {})).toBe(10)
    expect(getConsumerFairUseLimit('complexityAnalysesPerDay', {})).toBe(5)
    expect(getConsumerFairUseLimit('creatorVerificationsPerDay', {})).toBe(5)
    expect(getConsumerFairUseLimit('globalCodeExecutionsPerDay', {})).toBe(5000)
    expect(getConsumerFairUseLimit('globalPromptEvaluationsPerDay', {})).toBe(500)
    expect(getConsumerFairUseLimit('globalCreatorVerificationsPerDay', {})).toBe(100)
    expect(getConsumerFairUseLimit('practiceRunsPerDay', {
      CODEARENA_DAILY_PRACTICE_EXECUTION_LIMIT: '75'
    })).toBe(75)
    expect(getConsumerFairUseLimit('practiceRunsPerDay', {
      CODEARENA_DAILY_PRACTICE_EXECUTION_LIMIT: '0'
    })).toBe(25)
    expect(getConsumerFairUseLimit('creatorVerificationsPerDay', {
      CODEARENA_DAILY_CREATOR_VERIFICATION_LIMIT: '12'
    })).toBe(12)
    expect(getConsumerFairUseLimit('botBattlesPerDay', {
      CODEARENA_DAILY_BOT_BATTLE_LIMIT: '30'
    })).toBe(30)
  })
})
