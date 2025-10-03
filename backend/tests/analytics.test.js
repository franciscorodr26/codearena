/**
 * Analytics Module Tests
 *
 * Tests all analytics tracking methods to ensure:
 * 1. Correct Mixpanel events are fired
 * 2. Aggregated stats are updated properly
 * 3. Event deduplication works as expected
 * 4. All schema requirements are met
 */

// Mock Mixpanel module
const mockMixpanel = {
  init: jest.fn()
};

jest.mock('mixpanel', () => mockMixpanel);

const {
  Analytics,
  GameMode,
  BattleType,
  JoinMethod,
  Language,
  MatchmakingOutcome,
  BattleResult,
  OpponentType,
  RematchResponse,
  RematchRequestOutcome,
  FeedbackRating
} = require('../analytics');

describe('Analytics Class', () => {
  const originalToken = process.env.MIXPANEL_TOKEN
  let analytics;
  let mockMixpanelInstance;
  let trackCalls = [];

  beforeEach(() => {
    process.env.MIXPANEL_TOKEN = 'codearena-test-project'
    // Reset track calls
    trackCalls = [];

    // Create mock Mixpanel instance
    mockMixpanelInstance = {
      track: jest.fn((eventName, payload) => {
        trackCalls.push({ eventName, payload });
      }),
      identify: jest.fn()
    };

    // Configure mock to return our instance
    mockMixpanel.init.mockReturnValue(mockMixpanelInstance);

    // Initialize analytics in test mode using class directly
    analytics = new Analytics({ test: true });
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.MIXPANEL_TOKEN
    else process.env.MIXPANEL_TOKEN = originalToken
    jest.clearAllMocks();
  });

  it('does not send events to an implicit shared project when no token is configured', () => {
    delete process.env.MIXPANEL_TOKEN
    mockMixpanel.init.mockClear()
    const unconfigured = new Analytics()
    expect(unconfigured.trackViewHome('player123', {})).toBeDefined()
    expect(mockMixpanel.init).not.toHaveBeenCalled()
    expect(mockMixpanelInstance.track).not.toHaveBeenCalled()
  })

  describe('Navigation Events', () => {
    it('should track view_home event', () => {
      analytics.trackViewHome('player123', { referrer: 'google.com', utmSource: 'search', clientTs: 1717171717 });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('view_home');
      expect(trackCalls[0].payload.distinct_id).toBe('player123');
      expect(trackCalls[0].payload.referrer).toBe('google.com');
      expect(trackCalls[0].payload.utm_source).toBe('search');
      expect(trackCalls[0].payload.client_ts).toBe(1717171717);
    });

    it('should track view_modes event', () => {
      analytics.trackViewModes('player456', { referrerPage: '/home', clientTs: 1717171717 });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('view_modes');
      expect(trackCalls[0].payload.distinct_id).toBe('player456');
      expect(trackCalls[0].payload.referrer_page).toBe('/home');
      expect(trackCalls[0].payload.client_ts).toBe(1717171717);
    });

    it('should track select_game_mode event', () => {
      analytics.trackSelectGameMode('player789', {
        modeSelected: GameMode.QUICK_MATCH
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('select_game_mode');
      expect(trackCalls[0].payload.mode_selected).toBe('QUICK_MATCH');
    });
  });

  describe('Battle Lifecycle Events', () => {
    it('should track join_battle and update stats', () => {
      analytics.trackJoinBattle('player456', {
        battleId: 'battle789',
        playerName: 'TestPlayer',
        joinMethod: JoinMethod.DIRECT_LINK
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('join_battle');
      expect(trackCalls[0].payload.join_method).toBe('DIRECT_LINK');

      const stats = analytics.getStats();
      expect(stats.battlesJoined).toBe(1);
    });

    it('should track select_language and update stats', () => {
      analytics.trackSelectLanguage('player123', {
        battleId: 'battle456',
        playerName: 'TestPlayer',
        language: Language.JAVASCRIPT
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('select_language');
      expect(trackCalls[0].payload.language).toBe('JAVASCRIPT');

      const stats = analytics.getStats();
      expect(stats.languageStats.javascript).toBe(1);
    });

    it('should track ready_for_battle event', () => {
      analytics.trackReadyForBattle('player123', {
        battleId: 'battle456',
        playerName: 'TestPlayer',
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        playerLanguage: Language.PYTHON,
        opponentLanguage: Language.JAVASCRIPT,
        problemId: 'two-sum',
        opponentId: 'player456',
        opponentName: 'OpponentPlayer'
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('ready_for_battle');
      expect(trackCalls[0].payload.player_language).toBe('PYTHON');
      expect(trackCalls[0].payload.opponent_language).toBe('JAVASCRIPT');
      expect(trackCalls[0].payload.opponent_type).toBe('HUMAN');
    });

    it('should track start_battle with per-player problem tracking', () => {
      // First player starts battle
      analytics.trackStartBattle('player123', {
        battleId: 'battle456',
        playerName: 'Player1',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        battleType: BattleType.QUICK_MATCH,
        opponentId: 'player456',
        opponentName: 'Player2'
      });

      let stats = analytics.getStats();
      expect(stats.battlesStarted).toBe(1);
      expect(stats.problemStats['two-sum'].started).toBe(1);

      // Second player starts same battle (battle count stays same, problem count increments per player)
      analytics.trackStartBattle('player456', {
        battleId: 'battle456',
        playerName: 'Player2',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        battleType: BattleType.QUICK_MATCH,
        opponentId: 'player123',
        opponentName: 'Player1'
      });

      stats = analytics.getStats();
      expect(stats.battlesStarted).toBe(1); // Still 1 - same battle
      expect(stats.problemStats['two-sum'].started).toBe(2); // Now 2 - per player tracking

      // Different battle should increment both battle and problem stats
      analytics.trackStartBattle('player789', {
        battleId: 'battle789',
        playerName: 'Player3',
        problemId: 'palindrome-number',
        problemName: 'Palindrome Number',
        problemDifficulty: 'EASY',
        battleType: BattleType.PRIVATE,
        opponentId: 'player999',
        opponentName: 'Player4'
      });

      stats = analytics.getStats();
      expect(stats.battlesStarted).toBe(2);
      expect(stats.problemStats['palindrome-number'].started).toBe(1);
    });
  });

  describe('Matchmaking Events', () => {
    it('should track begin_matchmaking and update stats', () => {
      analytics.trackBeginMatchmaking('player123', {
        playerName: 'TestPlayer',
        language: Language.PYTHON,
        queueType: 'QUICK_MATCH'
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('begin_matchmaking');
      expect(trackCalls[0].payload.language).toBe('PYTHON');
      expect(trackCalls[0].payload.queue_type).toBe('QUICK_MATCH');

      const stats = analytics.getStats();
      expect(stats.matchmakingStats.queueJoins).toBe(1);
    });

    it('should track end_matchmaking with match found', () => {
      analytics.trackEndMatchmaking('player123', {
        playerName: 'TestPlayer',
        outcome: MatchmakingOutcome.MATCH_FOUND,
        waitTimeSeconds: 5,
        battleId: 'battle123',
        opponentId: 'player456',
        opponentName: 'Opponent'
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('end_matchmaking');
      expect(trackCalls[0].payload.outcome).toBe('MATCH_FOUND');

      const stats = analytics.getStats().matchmakingStats;
      expect(stats.matchesFound).toBe(1);
      expect(stats.totalWaitTime).toBe(5000); // Converted to ms
    });

    it('should track end_matchmaking with timeout', () => {
      analytics.trackEndMatchmaking('player789', {
        playerName: 'TimeoutPlayer',
        outcome: MatchmakingOutcome.TIMEOUT,
        waitTimeSeconds: 60
      });

      const stats = analytics.getStats().matchmakingStats;
      expect(stats.timeouts).toBe(1);
    });

    it('should track end_matchmaking with cancelled', () => {
      analytics.trackEndMatchmaking('player999', {
        playerName: 'CancelPlayer',
        outcome: MatchmakingOutcome.CANCELLED,
        waitTimeSeconds: 10
      });

      expect(trackCalls[0].payload.outcome).toBe('CANCELLED');
    });
  });

  describe('Gameplay Events', () => {
    it('should track begin_solution event', () => {
      analytics.trackBeginSolution('player123', {
        battleId: 'battle456',
        playerName: 'TestPlayer',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY'
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('begin_solution');
      expect(trackCalls[0].payload.problem_id).toBe('two-sum');
    });

    it('should track submit_solution event', () => {
      analytics.trackSubmitSolution('player123', {
        battleId: 'battle456',
        playerName: 'TestPlayer',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        accepted: true,
        testcasesPassed: 5,
        testcasesFailed: 0,
        violations: 0,
        submissionUuid: 'sub_123'
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('submit_solution');
      expect(trackCalls[0].payload.accepted).toBe(true);
      expect(trackCalls[0].payload.testcases_passed).toBe(5);
      expect(trackCalls[0].payload.violations).toBe(0);
    });

    it('should track end_battle with different player results', () => {
      // Track a completed battle where player won and solved the problem
      analytics.trackEndBattle('player123', {
        battleId: 'battle123',
        playerName: 'Winner',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.WIN,
        opponentResult: BattleResult.LOSE,
        durationSeconds: 300,
        submissionsCount: 1,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        problemSolved: true,
        opponentId: 'player456',
        opponentName: 'Loser'
      });

      let stats = analytics.getStats();
      expect(stats.battlesCompleted).toBe(1);
      expect(stats.problemStats['two-sum'].completed).toBe(1);
      expect(stats.totalBattleTime).toBe(300);

      // Track a player who forfeited
      analytics.trackEndBattle('player456', {
        battleId: 'battle456',
        playerName: 'Forfeiter',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.FORFEIT,
        opponentResult: BattleResult.WIN,
        durationSeconds: 100,
        submissionsCount: 0,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        problemSolved: false,
        opponentId: 'player789',
        opponentName: 'Winner'
      });

      stats = analytics.getStats();
      expect(stats.battlesForfeited).toBe(1);

      // Track a player who abandoned
      analytics.trackEndBattle('player789', {
        battleId: 'battle789',
        playerName: 'Abandoner',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.ABANDON,
        opponentResult: BattleResult.WIN,
        durationSeconds: 50,
        submissionsCount: 0,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        problemSolved: false,
        opponentId: 'player111',
        opponentName: 'Opponent'
      });

      stats = analytics.getStats();
      expect(stats.battlesAbandoned).toBe(1);

      // Track a player who lost but battle was completed
      analytics.trackEndBattle('player111', {
        battleId: 'battle111',
        playerName: 'Loser',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.LOSE,
        opponentResult: BattleResult.WIN,
        durationSeconds: 600,
        submissionsCount: 5,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.TOURNAMENT,
        problemSolved: false,
        opponentId: 'player222',
        opponentName: 'Winner'
      });

      stats = analytics.getStats();
      expect(stats.battlesCompleted).toBe(2); // Both WIN and LOSE count as completed

      // Track a player who timed out
      analytics.trackEndBattle('player222', {
        battleId: 'battle222',
        playerName: 'TimeoutPlayer',
        problemId: 'palindrome-number',
        problemName: 'Palindrome Number',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.TIMEOUT,
        opponentResult: BattleResult.WIN,
        durationSeconds: 400,
        submissionsCount: 2,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        problemSolved: false,
        opponentId: 'player333',
        opponentName: 'Opponent'
      });

      stats = analytics.getStats();
      // TIMEOUT should contribute to battle time but not increment battlesCompleted
      expect(stats.totalBattleTime).toBe(1300); // 300 + 600 + 400
    });
  });

  describe('Rematch Events', () => {
    it('should track rematch flow without double counting', () => {
      // Request rematch
      analytics.trackRequestRematch('player123', {
        playerName: 'Requester',
        originalBattleId: 'battle123',
        opponentId: 'player456',
        opponentName: 'Opponent',
        originalOutcome: 'LOSS'
      });

      let stats = analytics.getStats().rematchStats;
      expect(stats.requested).toBe(1);

      // Accept rematch
      analytics.trackRespondToRematchRequest('player456', {
        playerName: 'Responder',
        originalBattleId: 'battle123',
        response: RematchResponse.ACCEPT,
        requesterId: 'player123',
        requesterName: 'Requester',
        newBattleId: 'battle456',
        responseTimeSeconds: 5
      });

      stats = analytics.getStats().rematchStats;
      expect(stats.accepted).toBe(1);

      // End rematch request (should NOT increment accepted again)
      analytics.trackEndRematchRequest('player123', {
        playerName: 'Requester',
        originalBattleId: 'battle123',
        outcome: RematchRequestOutcome.ACCEPTED,
        waitTimeSeconds: 5,
        opponentId: 'player456',
        opponentName: 'Opponent',
        newBattleId: 'battle456'
      });

      stats = analytics.getStats().rematchStats;
      expect(stats.accepted).toBe(1); // Should still be 1, not 2

      // Test decline flow
      analytics.trackRespondToRematchRequest('player789', {
        playerName: 'Decliner',
        originalBattleId: 'battle789',
        response: RematchResponse.DECLINE,
        requesterId: 'player111',
        requesterName: 'Requester2'
      });

      stats = analytics.getStats().rematchStats;
      expect(stats.declined).toBe(1);

      // Test expired outcome
      analytics.trackEndRematchRequest('player222', {
        playerName: 'ExpiredRequester',
        originalBattleId: 'battle222',
        outcome: RematchRequestOutcome.EXPIRED,
        waitTimeSeconds: 60
      });

      stats = analytics.getStats().rematchStats;
      expect(stats.expired).toBe(1);
    });
  });

  describe('Feedback Events', () => {
    it('should track send_feedback event', () => {
      analytics.trackSendFeedback('player123', {
        playerName: 'TestPlayer',
        battleId: 'battle123',
        rating: FeedbackRating.AMAZING,
        suggestion: 'Great game!',
        email: 'test@example.com'
      });

      expect(mockMixpanelInstance.track).toHaveBeenCalledTimes(1);
      expect(trackCalls[0].eventName).toBe('send_feedback');
      expect(trackCalls[0].payload.rating).toBe(5);
      expect(trackCalls[0].payload.suggestion).toBe('Great game!');
    });

    it('should handle different feedback ratings', () => {
      analytics.trackSendFeedback('player456', {
        rating: FeedbackRating.COULD_BE_BETTER,
        suggestion: 'Too difficult'
      });

      expect(trackCalls[0].payload.rating).toBe(2);
    });
  });

  describe('Class Properties', () => {
    it('should have testMode property set correctly', () => {
      expect(analytics.testMode).toBe(true);

      const prodAnalytics = new Analytics({ test: false });
      expect(prodAnalytics.testMode).toBe(false);
    });

    it('should track events with test flag when in test mode', () => {
      analytics.trackViewHome('player123', { referrer: 'google.com' });

      expect(trackCalls[0].payload.is_test_event).toBe(true);
    });
  });

  describe('Aggregated Stats', () => {
    it('should return frozen copies of stats', () => {
      const stats1 = analytics.getStats();
      const stats2 = analytics.getStats();

      // Should return frozen copies
      expect(Object.isFrozen(stats1)).toBe(true);
      // Should be new copies each time
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });

    it('should calculate average battle duration correctly', () => {
      // Track multiple battles with different durations
      analytics.trackEndBattle('player1', {
        battleId: 'battle1',
        playerName: 'Player1',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.WIN,
        opponentResult: BattleResult.LOSE,
        durationSeconds: 100,
        submissionsCount: 1,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        problemSolved: true,
        opponentId: 'player2',
        opponentName: 'Player2'
      });

      let stats = analytics.getStats();
      expect(stats.averageBattleDuration).toBe(100);

      analytics.trackEndBattle('player2', {
        battleId: 'battle2',
        playerName: 'Player2',
        problemId: 'two-sum',
        problemName: 'Two Sum',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.LOSE,
        opponentResult: BattleResult.WIN,
        durationSeconds: 200,
        submissionsCount: 2,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        problemSolved: false,
        opponentId: 'player1',
        opponentName: 'Player1'
      });

      stats = analytics.getStats();
      expect(stats.averageBattleDuration).toBe(150); // (100 + 200) / 2

      analytics.trackEndBattle('player3', {
        battleId: 'battle3',
        playerName: 'Player3',
        problemId: 'palindrome-number',
        problemName: 'Palindrome Number',
        problemDifficulty: 'EASY',
        playerResult: BattleResult.WIN,
        opponentResult: BattleResult.LOSE,
        durationSeconds: 300,
        submissionsCount: 1,
        opponentType: OpponentType.HUMAN,
        battleType: BattleType.QUICK_MATCH,
        problemSolved: true,
        opponentId: 'player4',
        opponentName: 'Player4'
      });

      stats = analytics.getStats();
      expect(stats.averageBattleDuration).toBe(200); // (100 + 200 + 300) / 3
    });
  });

  describe('Mixpanel Event Structure', () => {
    it('should include required Mixpanel fields', () => {
      analytics.trackJoinBattle('player123', {
        battleId: 'battle789',
        playerName: 'TestPlayer',
        joinMethod: JoinMethod.MATCHMAKING
      });

      const call = trackCalls[0];
      expect(call.payload).toHaveProperty('time');
      expect(call.payload).toHaveProperty('$insert_id');
      expect(call.payload).toHaveProperty('schema_version', 'v0');
      expect(call.payload).toHaveProperty('is_test_event', true);
      expect(call.payload).toHaveProperty('distinct_id', 'player123');
    });

    it('should include $groups for battle events', () => {
      analytics.trackJoinBattle('player123', {
        battleId: 'battle789',
        playerName: 'TestPlayer',
        joinMethod: JoinMethod.MATCHMAKING
      });

      const call = trackCalls[0];
      expect(call.payload).toHaveProperty('$groups');
      expect(call.payload.$groups).toEqual({
        battle: 'battle789'
      });
    });

    it('should generate unique insert IDs', () => {
      const insertIds = new Set();

      // Track multiple events
      for (let i = 0; i < 5; i++) {
        analytics.trackJoinBattle(`player${i}`, {
          battleId: `battle${i}`,
          playerName: `Player${i}`,
          joinMethod: JoinMethod.DIRECT_LINK
        });
      }

      // Check that all insert IDs are unique
      trackCalls.forEach(call => {
        const insertId = call.payload.$insert_id;
        expect(insertIds.has(insertId)).toBe(false);
        insertIds.add(insertId);
      });
    });
  });
});
