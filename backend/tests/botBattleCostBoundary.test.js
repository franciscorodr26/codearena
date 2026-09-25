const fs = require('fs')
const path = require('path')

describe('bot battle cost boundary', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

  it('applies authenticated request, daily creation, active-cap, and start guards', () => {
    expect(serverSource).toContain('botBattleGuard.checkRequest(socket.userId)')
    expect(serverSource).toContain("getConsumerFairUseLimit('botBattlesPerDay')")
    expect(serverSource).toContain("metric: 'bot_battle_creation'")
    expect(serverSource).toContain('botBattleGuard.canCreate(humanUserId, battles')
    expect(serverSource).toContain('botBattleGuard.checkStart(socket.userId, battle.id)')
    expect(serverSource).toContain('botBattleGuard.pruneExpiredBattles(battles')
  })

  it('reserves durable global execution quota before the bot reaches Judge0', () => {
    const submissionStart = serverSource.indexOf('async function submitBotSolution')
    const submissionEnd = serverSource.indexOf('// FIXED: Complete createRematchBattle', submissionStart)
    const submissionSource = serverSource.slice(submissionStart, submissionEnd)
    const quotaIndex = submissionSource.indexOf("metric: 'code_execution', subjectId: 'global'")
    const executionIndex = submissionSource.indexOf('await executeAndValidateSolution(')

    expect(quotaIndex).toBeGreaterThan(0)
    expect(executionIndex).toBeGreaterThan(quotaIndex)
    expect(submissionSource).toContain('if (!executionQuota?.allowed)')
    expect(submissionSource).toContain("emit('bot-submission-unavailable'")
  })
})
