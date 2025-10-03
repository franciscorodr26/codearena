/**
 * Unified Analytics Module
 *
 * Consolidates all analytics tracking for CodeArena MVP:
 * - Mixpanel events (source of truth)
 * - Aggregated statistics (derived from Mixpanel events)
 */

const Mixpanel = require('mixpanel');
const { config, logLevels } = require('./config/env');
const logger = require('./utils/logger');

// Game mode enum
const GameMode = Object.freeze({
  QUICK_MATCH: 'QUICK_MATCH',
  PRACTICE: 'PRACTICE',
  PRIVATE_BATTLE: 'PRIVATE_BATTLE'
});

// Battle type enum
const BattleType = Object.freeze({
  QUICK_MATCH: 'QUICK_MATCH',
  PRIVATE: 'PRIVATE',
  PRACTICE: 'PRACTICE',
  REMATCH: 'REMATCH',
  TOURNAMENT: 'TOURNAMENT'
});

// Join method enum
const JoinMethod = Object.freeze({
  DIRECT_LINK: 'DIRECT_LINK',
  MATCHMAKING: 'MATCHMAKING',
  REMATCH: 'REMATCH',
  MANUAL_ENTRY: 'MANUAL_ENTRY'
});

// Language enum
const Language = Object.freeze({
  JAVASCRIPT: 'JAVASCRIPT',
  PYTHON: 'PYTHON',
  JAVA: 'JAVA',
  CPP: 'CPP',
  GO: 'GO',
  RUST: 'RUST'
});

// Matchmaking outcome enum
const MatchmakingOutcome = Object.freeze({
  MATCH_FOUND: 'MATCH_FOUND',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED'
});

// Battle result enum - each player's result
const BattleResult = Object.freeze({
  WIN: 'WIN',
  LOSE: 'LOSE',
  FORFEIT: 'FORFEIT',
  ABANDON: 'ABANDON',
  TIMEOUT: 'TIMEOUT'
});

// Opponent type enum
const OpponentType = Object.freeze({
  NONE: 'NONE',
  BOT: 'BOT',
  HUMAN: 'HUMAN'
});

// Rematch response enum
const RematchResponse = Object.freeze({
  ACCEPT: 'ACCEPT',
  DECLINE: 'DECLINE'
});

// Rematch outcome enum
const RematchRequestOutcome = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
});

// Feedback rating - numeric scale (1-5)
const FeedbackRating = Object.freeze({
  NEEDS_WORK: 1,
  COULD_BE_BETTER: 2,
  GOOD: 3,
  GREAT: 4,
  AMAZING: 5
});

class Analytics {
  constructor(options = {}) {
    this.testMode = options.test || false;
    // A separate deployment must explicitly opt in to its analytics project.
    this.mixpanel = process.env.MIXPANEL_TOKEN
      ? Mixpanel.init(process.env.MIXPANEL_TOKEN)
      : null;
    this.MIXPANEL_SCHEMA_VERSION = 'v0';

    // Aggregated statistics object - UPDATED with all 20 problems
    this.stats = {
      battlesCreated: 0,
      battlesJoined: 0,
      battlesStarted: 0,
      battlesCompleted: 0,
      battlesAbandoned: 0,
      battlesForfeited: 0,
      totalBattleTime: 0,
      averageBattleDuration: 0,
      battleTypeStats: {
        quickMatch: 0,
        private: 0,
        practice: 0
      },
      problemStats: {
        // Original 3 problems
        'two-sum': { started: 0, completed: 0, averageTime: 0 },
        'palindrome-number': { started: 0, completed: 0, averageTime: 0 },
        'valid-parentheses': { started: 0, completed: 0, averageTime: 0 },
        // New 17 problems
        'reverse-integer': { started: 0, completed: 0, averageTime: 0 },
        'fizz-buzz': { started: 0, completed: 0, averageTime: 0 },
        'merge-sorted-arrays': { started: 0, completed: 0, averageTime: 0 },
        'maximum-subarray': { started: 0, completed: 0, averageTime: 0 },
        'contains-duplicate': { started: 0, completed: 0, averageTime: 0 },
        'best-time-stock': { started: 0, completed: 0, averageTime: 0 },
        'valid-anagram': { started: 0, completed: 0, averageTime: 0 },
        'missing-number': { started: 0, completed: 0, averageTime: 0 },
        'single-number': { started: 0, completed: 0, averageTime: 0 },
        'climbing-stairs': { started: 0, completed: 0, averageTime: 0 },
        'move-zeroes': { started: 0, completed: 0, averageTime: 0 },
        'reverse-string': { started: 0, completed: 0, averageTime: 0 },
        'first-unique-character': { started: 0, completed: 0, averageTime: 0 },
        'linked-list-cycle': { started: 0, completed: 0, averageTime: 0 },
        'valid-palindrome': { started: 0, completed: 0, averageTime: 0 },
        'binary-search': { started: 0, completed: 0, averageTime: 0 },
        'product-array-except-self': { started: 0, completed: 0, averageTime: 0 },
        'longest-substring': { started: 0, completed: 0, averageTime: 0 }
      },
      languageStats: {
        javascript: 0,
        python: 0,
        java: 0,
        cpp: 0,
        go: 0,
        rust: 0
      },
      matchmakingStats: {
        queueJoins: 0,
        matchesFound: 0,
        timeouts: 0,
        totalWaitTime: 0,
        averageWaitTime: 0
      },
      rematchStats: {
        requested: 0,
        accepted: 0,
        declined: 0,
        expired: 0,
        cancelled: 0
      }
    };

    // Track battle states for proper stat counting
    this.battleStates = new Map();
  }

  /**
   * Track an event with common properties
   * @param {string} eventName - The name of the event to track
   * @param {string} playerId - The unique identifier for the player (used as distinct_id)
   * @param {Object} props - Event properties object
   * @param {Object} options - Additional options (ip for geo-location)
   * @returns {Object} Tracking result object
   */
  trackEvent(eventName, playerId, props, options = {}) {
    try {
      const payload = {
        distinct_id: playerId,
        time: Math.floor(Date.now() / 1000),
        $insert_id: crypto.randomUUID(),
        ...props,
        schema_version: this.MIXPANEL_SCHEMA_VERSION
      };

      // Add IP for geo-location if provided
      if (options.ip) {
        payload.ip = options.ip;
      }

      // Add battle group for battle-related events
      if (props.battle_id && props.battle_id !== 'N/A') {
        payload.$groups = { battle: props.battle_id };
      }

      payload.is_test_event = this.testMode;

      this.mixpanel?.track(eventName, payload);

      // Log based on log level
      if (config.logLevel === logLevels.VERBOSE) {
        logger.debug(`[MIXPANEL] Tracked: ${eventName}`, payload);
      } else {
        logger.debug(`[MIXPANEL] Tracked: ${eventName}`);
      }

      return { success: true, event: eventName, payload };
    } catch (error) {
      logger.error(`[ANALYTICS] Failed to track ${eventName}:`, error);
      return { success: true, event: eventName, payload: props };
    }
  }

  /**
   * Get a frozen copy of aggregated stats
   */
  getStats() {
    return Object.freeze(JSON.parse(JSON.stringify(this.stats)));
  }

  /**
   * Track home page view
   */
  trackViewHome(playerId, props = {}) {
    const { referrer, utmSource, utmMedium, utmCampaign, clientTs } = props;
    const result = this.trackEvent('view_home', playerId, {
      player_id: playerId,
      referrer,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      client_ts: clientTs
    });

    return result;
  }

  /**
   * Track modes page view
   */
  trackViewModes(playerId, props = {}) {
    const { referrerPage, clientTs } = props;
    const result = this.trackEvent('view_modes', playerId, {
      player_id: playerId,
      referrer_page: referrerPage,
      client_ts: clientTs
    });

    return result;
  }

  /**
   * Track game mode selection
   */
  trackSelectGameMode(playerId, props) {
    const { modeSelected } = props;
    const result = this.trackEvent('select_game_mode', playerId, {
      player_id: playerId,
      mode_selected: modeSelected
    });

    return result;
  }

  /**
   * Track battle join
   */
  trackJoinBattle(playerId, props) {
    const { battleId, playerName, joinMethod } = props;
    const result = this.trackEvent('join_battle', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      join_method: joinMethod
    });

    this.stats.battlesJoined++;
    return result;
  }

  /**
   * Track language selection
   */
  trackSelectLanguage(playerId, props) {
    const { battleId, playerName, language } = props;
    const result = this.trackEvent('select_language', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      language: language
    });

    if (language && language.toLowerCase() in this.stats.languageStats) {
      this.stats.languageStats[language.toLowerCase()]++;
    }
    return result;
  }

  /**
   * Track begin matchmaking
   */
  trackBeginMatchmaking(playerId, props) {
    const { playerName, language, queueType = 'QUICK_MATCH' } = props;
    const result = this.trackEvent('begin_matchmaking', playerId, {
      player_id: playerId,
      player_name: playerName,
      language: language,
      queue_type: queueType
    });

    this.stats.matchmakingStats.queueJoins++;
    return result;
  }

  /**
   * Track end matchmaking
   */
  trackEndMatchmaking(playerId, props) {
    const { playerName, outcome, waitTimeSeconds, battleId, opponentId, opponentName } = props;
    const result = this.trackEvent('end_matchmaking', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      outcome: outcome,
      wait_time_seconds: waitTimeSeconds,
      opponent_id: opponentId,
      opponent_name: opponentName
    });

    if (outcome === MatchmakingOutcome.MATCH_FOUND) {
      this.stats.matchmakingStats.matchesFound++;
      if (waitTimeSeconds) {
        this.stats.matchmakingStats.totalWaitTime += waitTimeSeconds * 1000;
        this.stats.matchmakingStats.averageWaitTime = this.stats.matchmakingStats.matchesFound > 0
          ? this.stats.matchmakingStats.totalWaitTime / this.stats.matchmakingStats.matchesFound
          : 0;
      }
    } else if (outcome === MatchmakingOutcome.TIMEOUT) {
      this.stats.matchmakingStats.timeouts++;
    }
    return result;
  }

  /**
   * Track ready for battle
   */
  trackReadyForBattle(playerId, props) {
    const { battleId, playerName, opponentType, battleType, playerLanguage, opponentLanguage, problemId, opponentId, opponentName } = props;
    const result = this.trackEvent('ready_for_battle', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      opponent_type: opponentType,
      battle_type: battleType,
      player_language: playerLanguage,
      opponent_language: opponentLanguage,
      problem_id: problemId,
      opponent_id: opponentId,
      opponent_name: opponentName
    });

    return result;
  }

  /**
   * Track battle start
   */
  trackStartBattle(playerId, props) {
    const { battleId, playerName, problemId, problemName, problemDifficulty, battleType, opponentId, opponentName } = props;
    const result = this.trackEvent('start_battle', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      problem_id: problemId,
      problem_name: problemName,
      problem_difficulty: problemDifficulty,
      battle_type: battleType,
      opponent_id: opponentId,
      opponent_name: opponentName
    });

    if (!this.battleStates.has(battleId)) {
      this.battleStates.set(battleId, 'started');
      this.stats.battlesStarted++;
      
      if (battleType) {
        const battleTypeKey = battleType.toLowerCase().replace('_', '');
        if (battleTypeKey === 'quickmatch') {
          this.stats.battleTypeStats.quickMatch++;
        } else if (battleTypeKey === 'private') {
          this.stats.battleTypeStats.private++;
        } else if (battleTypeKey === 'practice') {
          this.stats.battleTypeStats.practice++;
        }
      }
    }

    if (problemId && this.stats.problemStats[problemId]) {
      this.stats.problemStats[problemId].started++;
    }
    return result;
  }

  /**
   * Track begin solution
   */
  trackBeginSolution(playerId, props) {
    const { battleId, playerName, problemId, problemName, problemDifficulty } = props;
    const result = this.trackEvent('begin_solution', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      problem_id: problemId,
      problem_name: problemName,
      problem_difficulty: problemDifficulty
    });

    return result;
  }

  /**
   * Track submit solution
   */
  trackSubmitSolution(playerId, props) {
    const { battleId, playerName, problemId, problemName, problemDifficulty, accepted, testcasesPassed, testcasesFailed, violations, submissionUuid } = props;
    const result = this.trackEvent('submit_solution', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      problem_id: problemId,
      problem_name: problemName,
      problem_difficulty: problemDifficulty,
      accepted: accepted,
      testcases_passed: testcasesPassed,
      testcases_failed: testcasesFailed,
      violations: violations,
      submission_uuid: submissionUuid
    });

    return result;
  }

  /**
   * Track end battle
   */
  trackEndBattle(playerId, props) {
    const { battleId, playerName, problemId, problemName, problemDifficulty, playerResult, opponentResult, durationSeconds, submissionsCount, opponentType, battleType, problemSolved = false, opponentId, opponentName } = props;
    const result = this.trackEvent('end_battle', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      problem_id: problemId,
      problem_name: problemName,
      problem_difficulty: problemDifficulty,
      player_result: playerResult,
      opponent_result: opponentResult,
      duration_seconds: durationSeconds,
      submissions_count: submissionsCount,
      opponent_type: opponentType,
      battle_type: battleType,
      problem_solved: problemSolved,
      opponent_id: opponentId,
      opponent_name: opponentName
    });

    const currentState = this.battleStates.get(battleId);

    if (playerResult === BattleResult.WIN || playerResult === BattleResult.LOSE) {
      if (currentState !== 'completed') {
        this.stats.battlesCompleted++;
        this.battleStates.set(battleId, 'completed');
      }
    } else if (playerResult === BattleResult.FORFEIT) {
      if (currentState !== 'completed') {
        this.stats.battlesForfeited++;
        this.battleStates.set(battleId, 'completed');
      }
    } else if (playerResult === BattleResult.ABANDON) {
      if (currentState !== 'completed') {
        this.stats.battlesAbandoned++;
        this.battleStates.set(battleId, 'completed');
      }
    }

    if (durationSeconds && (playerResult === BattleResult.WIN || playerResult === BattleResult.LOSE || playerResult === BattleResult.TIMEOUT)) {
      this.stats.totalBattleTime += durationSeconds;
      this.stats.averageBattleDuration = this.stats.totalBattleTime / this.stats.battlesCompleted;
    }

    if (problemId && this.stats.problemStats[problemId] && problemSolved) {
      this.stats.problemStats[problemId].completed++;
    }

    return result;
  }

  /**
   * Track request rematch
   */
  trackRequestRematch(playerId, props) {
    const { playerName, originalBattleId, opponentId, opponentName, originalOutcome } = props;
    const result = this.trackEvent('request_rematch', playerId, {
      player_id: playerId,
      player_name: playerName,
      original_battle_id: originalBattleId,
      opponent_id: opponentId,
      opponent_name: opponentName,
      original_outcome: originalOutcome
    });

    this.stats.rematchStats.requested++;
    return result;
  }

  /**
   * Track respond to rematch request
   */
  trackRespondToRematchRequest(playerId, props) {
    const { playerName, originalBattleId, response, requesterId, requesterName, newBattleId, responseTimeSeconds } = props;
    const result = this.trackEvent('respond_to_rematch_request', playerId, {
      player_id: playerId,
      player_name: playerName,
      original_battle_id: originalBattleId,
      response: response,
      requester_id: requesterId,
      requester_name: requesterName,
      new_battle_id: newBattleId,
      response_time_seconds: responseTimeSeconds
    });

    if (response === RematchResponse.ACCEPT) {
      this.stats.rematchStats.accepted++;
    } else if (response === RematchResponse.DECLINE) {
      this.stats.rematchStats.declined++;
    }

    return result;
  }

  /**
   * Track rematch request end
   */
  trackEndRematchRequest(playerId, props) {
    const { playerName, originalBattleId, outcome, waitTimeSeconds, opponentId, opponentName, newBattleId } = props;
    const result = this.trackEvent('end_rematch_request', playerId, {
      player_id: playerId,
      player_name: playerName,
      original_battle_id: originalBattleId,
      outcome: outcome,
      new_battle_id: newBattleId,
      wait_time_seconds: waitTimeSeconds,
      opponent_id: opponentId,
      opponent_name: opponentName
    });

    if (outcome === RematchRequestOutcome.EXPIRED) {
      this.stats.rematchStats.expired++;
    } else if (outcome === RematchRequestOutcome.CANCELLED) {
      this.stats.rematchStats.cancelled++;
    }
    return result;
  }

  /**
   * Track send feedback
   */
  trackSendFeedback(playerId, props) {
    const { playerName, battleId, rating, suggestion, email } = props;
    const result = this.trackEvent('send_feedback', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      rating: rating,
      suggestion: suggestion,
      email: email
    });

    return result;
  }

  // ============================================================================
  // TOURNAMENT ANALYTICS
  // ============================================================================

  /**
   * Track tournament view
   */
  trackViewTournament(playerId, props) {
    const { tournamentId, tournamentName, status } = props;
    return this.trackEvent('view_tournament', playerId, {
      player_id: playerId,
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      status: status
    });
  }

  /**
   * Track tournament registration
   */
  trackTournamentRegister(playerId, props) {
    const { tournamentId, tournamentName, participantCount } = props;
    return this.trackEvent('tournament_register', playerId, {
      player_id: playerId,
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      participant_count: participantCount
    });
  }

  /**
   * Track tournament unregister
   */
  trackTournamentUnregister(playerId, props) {
    const { tournamentId, tournamentName } = props;
    return this.trackEvent('tournament_unregister', playerId, {
      player_id: playerId,
      tournament_id: tournamentId,
      tournament_name: tournamentName
    });
  }

  /**
   * Track tournament match start
   */
  trackTournamentMatchStart(playerId, props) {
    const { tournamentId, tournamentName, matchId, round, opponentId, opponentName, problemId } = props;
    return this.trackEvent('tournament_match_start', playerId, {
      player_id: playerId,
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      match_id: matchId,
      round: round,
      opponent_id: opponentId,
      opponent_name: opponentName,
      problem_id: problemId
    });
  }

  /**
   * Track tournament match complete
   */
  trackTournamentMatchComplete(playerId, props) {
    const { tournamentId, tournamentName, matchId, round, result, opponentId, opponentName, durationSeconds } = props;
    return this.trackEvent('tournament_match_complete', playerId, {
      player_id: playerId,
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      match_id: matchId,
      round: round,
      result: result, // 'win', 'lose'
      opponent_id: opponentId,
      opponent_name: opponentName,
      duration_seconds: durationSeconds
    });
  }

  /**
   * Track tournament complete (final placement)
   */
  trackTournamentComplete(playerId, props) {
    const { tournamentId, tournamentName, placement, totalParticipants, matchesPlayed, matchesWon } = props;
    return this.trackEvent('tournament_complete', playerId, {
      player_id: playerId,
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      placement: placement,
      total_participants: totalParticipants,
      matches_played: matchesPlayed,
      matches_won: matchesWon
    });
  }

  // ============================================================================
  // WEEKLY CHALLENGE ANALYTICS
  // ============================================================================

  /**
   * Track weekly challenge view
   */
  trackViewChallenge(playerId, props) {
    const { challengeId, problemId, problemName, difficulty } = props;
    return this.trackEvent('view_challenge', playerId, {
      player_id: playerId,
      challenge_id: challengeId,
      problem_id: problemId,
      problem_name: problemName,
      difficulty: difficulty
    });
  }

  /**
   * Track challenge attempt start
   */
  trackChallengeStart(playerId, props) {
    const { challengeId, problemId, problemName, difficulty, language } = props;
    return this.trackEvent('challenge_start', playerId, {
      player_id: playerId,
      challenge_id: challengeId,
      problem_id: problemId,
      problem_name: problemName,
      difficulty: difficulty,
      language: language
    });
  }

  /**
   * Track challenge submission
   */
  trackChallengeSubmit(playerId, props) {
    const { challengeId, problemId, language, accepted, testcasesPassed, testcasesFailed, attemptNumber } = props;
    return this.trackEvent('challenge_submit', playerId, {
      player_id: playerId,
      challenge_id: challengeId,
      problem_id: problemId,
      language: language,
      accepted: accepted,
      testcases_passed: testcasesPassed,
      testcases_failed: testcasesFailed,
      attempt_number: attemptNumber
    });
  }

  /**
   * Track challenge complete (solved)
   */
  trackChallengeComplete(playerId, props) {
    const { challengeId, problemId, problemName, difficulty, language, solveTimeSeconds, attempts, leaderboardRank } = props;
    return this.trackEvent('challenge_complete', playerId, {
      player_id: playerId,
      challenge_id: challengeId,
      problem_id: problemId,
      problem_name: problemName,
      difficulty: difficulty,
      language: language,
      solve_time_seconds: solveTimeSeconds,
      attempts: attempts,
      leaderboard_rank: leaderboardRank
    });
  }

  /**
   * Track challenge leaderboard view
   */
  trackViewChallengeLeaderboard(playerId, props) {
    const { challengeId, problemId } = props;
    return this.trackEvent('view_challenge_leaderboard', playerId, {
      player_id: playerId,
      challenge_id: challengeId,
      problem_id: problemId
    });
  }

  // ============================================================================
  // RETENTION ANALYTICS
  // ============================================================================

  /**
   * Track returning battle completion - fires when a user who has already
   * completed at least 1 battle completes another battle.
   * Key retention metric: users who completed a battle and returned.
   */
  trackReturningBattleComplete(playerId, props) {
    const {
      playerName,
      battleId,
      problemId,
      problemDifficulty,
      battleType,
      previousBattleCount,
      daysSinceLastBattle,
      playerResult,
      opponentType
    } = props;

    return this.trackEvent('returning_battle_complete', playerId, {
      player_id: playerId,
      player_name: playerName,
      battle_id: battleId,
      problem_id: problemId,
      problem_difficulty: problemDifficulty,
      battle_type: battleType,
      previous_battle_count: previousBattleCount,
      days_since_last_battle: daysSinceLastBattle,
      player_result: playerResult,
      opponent_type: opponentType
    });
  }
}

module.exports = {
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
};
