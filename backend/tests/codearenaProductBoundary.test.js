// Guards the open edition's boundary: CodeArena is the consumer product for
// practicing, competing and socialising. Nothing from the hiring product this
// codebase once shared a repository with may come back, and the problem set
// is the open one under arena/.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(root, relativePath));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'coverage', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const serverSource = read('backend/server.js');
const schedulerSource = read('backend/services/scheduler.js');
const adminSource = read('backend/routes/admin.js');
const feedbackSource = read('backend/routes/feedback.js');
const aiSource = read('backend/routes/ai.js');
const paymentSource = read('backend/routes/payment.js');

describe('CodeArena open edition boundary', () => {
  test('the hiring product and its judges are gone from the backend tree', () => {
    const forbiddenFiles = [
      'backend/routes/company.js', 'backend/routes/webhooks.js', 'backend/routes/editorials.js',
      'backend/routes/promptingProblems.js', 'backend/routes/challengeTypes.js',
      'backend/services/aiCritique.js', 'backend/services/aiCritiqueTemplates', 'backend/services/findingsJudge.js',
      'backend/services/systemDesignJudge.js', 'backend/services/verificationEvaluator.js',
      'backend/services/reportGenerator.js', 'backend/services/cohortComparison.js', 'backend/services/codepairSocket.js',
      'backend/services/dailyVideo.js', 'backend/services/atsFieldMappings.js', 'backend/services/assessmentNotify.js',
      'backend/services/candidateMessages.js', 'backend/services/candidatePurgeScheduler.js',
      'backend/services/webhookService.js', 'backend/services/webhookRetry.js',
      'backend/services/agentSolver.js', 'backend/services/agentRunner.js', 'backend/services/arenaBattleRunner.js',
      'backend/services/agentSpendingLimiter.js', 'backend/services/agentRateLimiter.js', 'backend/services/agentChallenges.js',
      'backend/services/problemGenerator.js', 'backend/services/codeWrapper.js', 'backend/services/inputParser.js',
      'backend/services/codeExecutor.js', 'backend/services/codeSanitizer.js', 'backend/services/promptJudge.js',
      'backend/calibration', 'backend/data/problems', 'backend/data/editorials.json', 'backend/data/botSolutions.js',
      'backend/data/assessmentPacks.js', 'backend/data/assessmentTemplates.json', 'backend/data/companyPrep.js',
      'backend/data/lessons', 'backend/problems-extended.js', 'backend/weeklyProblems.js',
      'backend/scripts/generatedSolutions', 'backend/scripts/reports', 'backend/config/b2bThresholds.js',
      'backend/config/dataRetention.js', 'backend/utils/validateAssessmentSettings.js'
    ];
    for (const file of forbiddenFiles) expect(exists(file)).toBe(false);
  });

  test('no source file outside tests mentions the hiring product', () => {
    const markers = /deveval|recruiter|take-home|takehome|codepair|hiring manager|candidate_|assessment_session|ats_connection/i;
    const offenders = [];
    for (const dir of ['backend', 'shared']) {
      for (const file of walk(path.join(root, dir))) {
        if (!/\.(js|json|md|sql|yml|yaml)$/.test(file)) continue;
        if (/\/(tests|__tests__)\//.test(file)) continue;
        if (file.endsWith('migrations.lock.json')) continue; // append-only ledger of historical names
        const text = fs.readFileSync(file, 'utf8');
        const match = text.match(markers);
        if (match) offenders.push(`${path.relative(root, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('forbidden backend routers are not mounted and agent battles are gone', () => {
    const forbiddenMounts = [
      '/api/companies', '/api/company-challenges', '/api/assess', '/api/ats',
      '/api/reports', '/api/codepair', '/api/hiring', '/api/scheduling',
      '/api/takehome', '/api/interview', '/api/voice-interview', '/api/agent',
      '/api/arena', '/api/centaur', '/api/build-challenge', '/api/lessons',
      '/api/learn', '/api/ai-critique', '/api/verification-problems', '/api/campaign',
      '/api/webhooks', '/api/editorials', '/api/prompting-problems'
    ];
    for (const mount of forbiddenMounts) expect(serverSource).not.toContain(`app.use('${mount}'`);
    expect(serverSource).not.toContain('AGENT_PRODUCT_ENABLED');
    expect(serverSource).not.toContain('agentMatchmakingQueue');
    expect(serverSource).not.toContain('webhookService');
    expect(adminSource).not.toContain('agent-battles');
    expect(adminSource).not.toContain('centaur-stats');
    expect(schedulerSource).not.toContain('agentChallenges');
    expect(schedulerSource).not.toContain('Webhook retry queue processing scheduled');
    expect(schedulerSource).not.toContain('emailRetryQueueTask');
  });

  test('problems come only from the open set and hidden tests stay server-side', () => {
    expect(exists('backend/arena/problems')).toBe(true);
    expect(exists('backend/arena/solutions')).toBe(true);
    expect(exists('backend/data/prompting/prompts.json')).toBe(true);
    const loaderSource = read('backend/problemsLoader.js');
    expect(loaderSource).toContain("require('./arena/runner/problems')");
    expect(loaderSource).not.toContain('data/problems');
    expect(serverSource).toContain("require('./problemsLoader')");
    expect(serverSource).not.toContain("require('./weeklyProblems')");
    expect((serverSource.match(/problem: problemsLoader\.getVisibleProblem\(battle\.problem\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(read('backend/services/validateSolution.js')).toContain("require('../arena/runner')");
  });

  test('forbidden frontend product routes are absent', () => {
    const forbidden = [
      'company', 'assess', 'codepair', 'schedule', 'shared-report', 'takehome',
      'challenge-invite', 'agent-battle', 'agent-battles', 'agent-history.js',
      'agent-leaderboard.js', 'agent-matchmaking.js', 'agent-replay',
      'agent-spectate.js', 'agent-tournaments', 'arena.js', 'build-challenge.js',
      'centaur.js', 'coach.js', 'critique', 'learn', 'prep', 'my-interviews.js',
      'contact-sales.js', 'for-companies.js', 'try-ai-critique.js'
    ];
    for (const route of forbidden) expect(exists(`frontend/pages/${route}`)).toBe(false);
    expect(exists('frontend/utils/companies.js')).toBe(false);
    expect(exists('frontend/utils/companySignup.js')).toBe(false);
  });

  test('CreatorArena and feedback keep their cost controls, no recurring Pro upsell', () => {
    expect(aiSource).not.toContain("router.post('/prompt'");
    expect(aiSource).not.toContain('db.isUserPro(userId)');
    expect(aiSource).toContain('await db.deductCredits(userId, cost');
    expect(aiSource).toContain('await db.refundCredits(userId, cost');
    expect(paymentSource).not.toContain('updateCompanyBilling');
    expect(paymentSource).toContain('rejectRetiredConsumerSubscription');
    expect(read('frontend/components/Header.js')).not.toContain('Upgrade to Pro');
    expect(read('frontend/components/ProfileDropdown.js')).not.toContain('Upgrade to Pro');
    expect(exists('frontend/components/ProUpgradeModal.js')).toBe(false);
    expect(serverSource).toContain("app.use('/api/feedback', feedbackRouter)");
    expect(feedbackSource).toContain('DISABLED_COACH_PATHS');
  });

  test('core consumer routes remain present', () => {
    const allowed = [
      'frontend/pages/practice.js', 'frontend/pages/battle.js', 'frontend/pages/prompt-battle.js',
      'frontend/pages/bot-battle.js', 'frontend/pages/matchmaking.js', 'frontend/pages/tournaments/index.js',
      'frontend/pages/challenge.js', 'frontend/pages/create.js', 'frontend/pages/gallery/index.js',
      'frontend/pages/friends.js', 'frontend/pages/messages/index.js'
    ];
    for (const route of allowed) expect(exists(route)).toBe(true);
    for (const mount of ['/api/prompt-practice', '/api/prompt-battle', '/api/tournaments', '/api/friends', '/api/messages']) {
      expect(serverSource).toContain(`app.use('${mount}'`);
    }
  });
});
