const CODEARENA_PRODUCT_MODE = Object.freeze({
  consumer: Object.freeze({
    accessModel: 'free',
    paidSubscriptionsEnabled: false,
    coreFeatures: Object.freeze({
      battles: true,
      matchmaking: true,
      problems: true,
      leaderboards: true,
      practice: true
    }),
    optionalFeatures: Object.freeze({
      aiCoach: false,
      aiInterviews: false,
      voiceInterviews: false
    }),
    fairUse: Object.freeze({
      practiceRunsPerDay: 25,
      battleCodeExecutionsPerDay: 50,
      botBattlesPerDay: 20,
      promptPracticeAttemptsPerDay: 3,
      dailyChallengePromptEvaluationsPerDay: 3,
      promptBattleModelCallsPerDay: 10,
      complexityAnalysesPerDay: 5,
      creatorVerificationsPerDay: 5,
      globalCodeExecutionsPerDay: 5000,
      globalPromptEvaluationsPerDay: 500,
      globalCreatorVerificationsPerDay: 100
    })
  })
})

const FAIR_USE_ENV_VARS = Object.freeze({
  practiceRunsPerDay: 'CODEARENA_DAILY_PRACTICE_EXECUTION_LIMIT',
  battleCodeExecutionsPerDay: 'CODEARENA_DAILY_BATTLE_CODE_EXECUTION_LIMIT',
  botBattlesPerDay: 'CODEARENA_DAILY_BOT_BATTLE_LIMIT',
  promptPracticeAttemptsPerDay: 'CODEARENA_DAILY_PROMPT_PRACTICE_LIMIT',
  dailyChallengePromptEvaluationsPerDay: 'CODEARENA_DAILY_CHALLENGE_PROMPT_LIMIT',
  promptBattleModelCallsPerDay: 'CODEARENA_DAILY_PROMPT_BATTLE_MODEL_LIMIT',
  complexityAnalysesPerDay: 'CODEARENA_DAILY_COMPLEXITY_ANALYSIS_LIMIT',
  creatorVerificationsPerDay: 'CODEARENA_DAILY_CREATOR_VERIFICATION_LIMIT',
  globalCodeExecutionsPerDay: 'CODEARENA_GLOBAL_DAILY_CODE_EXECUTION_LIMIT',
  globalPromptEvaluationsPerDay: 'CODEARENA_GLOBAL_DAILY_PROMPT_EVALUATION_LIMIT',
  globalCreatorVerificationsPerDay: 'CODEARENA_GLOBAL_DAILY_CREATOR_VERIFICATION_LIMIT'
})

function getConsumerFairUseLimit(quotaName, environment) {
  const fallback = CODEARENA_PRODUCT_MODE.consumer.fairUse[quotaName]
  if (!Number.isFinite(fallback)) return null

  const env = environment || (typeof process !== 'undefined' ? process.env : {})
  const configured = Number.parseInt(env?.[FAIR_USE_ENV_VARS[quotaName]], 10)
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

function getConsumerQuotaStatus(used, limit, legacyIsPro = false) {
  const normalizedUsed = Math.max(0, Number(used) || 0)
  const normalizedLimit = Math.max(0, Number(limit) || 0)
  const paidAccess = CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled && legacyIsPro === true

  if (paidAccess) {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      isPro: true,
      accessModel: 'paid'
    }
  }

  return {
    allowed: normalizedUsed < normalizedLimit,
    remaining: Math.max(0, normalizedLimit - normalizedUsed),
    limit: normalizedLimit,
    isPro: false,
    accessModel: CODEARENA_PRODUCT_MODE.consumer.accessModel
  }
}

module.exports = {
  CODEARENA_PRODUCT_MODE,
  getConsumerFairUseLimit,
  getConsumerQuotaStatus
}
