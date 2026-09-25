/**
 * Unit tests for partial credit battle timeout system
 * Tests timeout outcome determination, ELO calculation, and event structure
 *
 * Note: These are unit tests that verify logic in isolation.
 * They don't test actual socket emissions or database writes.
 */

const elo = require('../elo');

// Mock battle and player objects matching server.js structure
function createMockBattle(options = {}) {
  return {
    id: 'test-battle-' + Date.now(),
    matchmade: options.matchmade ?? true,
    problem: {
      id: 'test-problem',
      testCases: new Array(options.totalTests || 10).fill({ input: '', expected: '' })
    },
    createdAt: new Date(Date.now() - 600000).toISOString(), // 10 min ago
    finishedAt: new Date().toISOString(),
    players: []
  };
}

function createMockPlayer(options = {}) {
  return {
    id: 'player-' + Math.random().toString(36).substr(2, 9),
    userId: options.userId || Math.floor(Math.random() * 10000),
    name: options.name || 'TestPlayer',
    language: options.language || 'python',
    testsPassed: options.testsPassed ?? 0,
    testsTotal: options.testsTotal || 10,
    rating: options.rating || 1000,
    totalGames: options.totalGames || 20
  };
}

describe('Partial Credit Unit Tests', () => {
  describe('timeout outcome determination', () => {
    // Replicate the logic from server.js for determining timeout outcomes
    function determineTimeoutOutcome(player1, player2) {
      const p1Tests = player1?.testsPassed || 0;
      const p2Tests = player2?.testsPassed || 0;

      if (p1Tests === 0 && p2Tests === 0) {
        return { type: 'tie', eloChange: false, reason: 'both_zero' };
      }
      if (p1Tests === p2Tests) {
        return { type: 'tie', eloChange: true, reason: 'equal_progress' };
      }
      // Different tests - determine winner
      const winner = p1Tests > p2Tests ? player1 : player2;
      const loser = p1Tests > p2Tests ? player2 : player1;
      return { type: 'partial_credit', winner, loser, eloChange: true };
    }

    test('scenario: P1 passes 7/10, P2 passes 3/10 - P1 wins partial credit', () => {
      const p1 = createMockPlayer({ name: 'Alice', testsPassed: 7 });
      const p2 = createMockPlayer({ name: 'Bob', testsPassed: 3 });

      const outcome = determineTimeoutOutcome(p1, p2);

      expect(outcome.type).toBe('partial_credit');
      expect(outcome.winner.name).toBe('Alice');
      expect(outcome.loser.name).toBe('Bob');
      expect(outcome.eloChange).toBe(true);
    });

    test('scenario: both pass 5/10 - tie with ELO adjustment', () => {
      const p1 = createMockPlayer({ name: 'Alice', testsPassed: 5 });
      const p2 = createMockPlayer({ name: 'Bob', testsPassed: 5 });

      const outcome = determineTimeoutOutcome(p1, p2);

      expect(outcome.type).toBe('tie');
      expect(outcome.reason).toBe('equal_progress');
      expect(outcome.eloChange).toBe(true);
    });

    test('scenario: both pass 0/10 - tie with NO ELO change', () => {
      const p1 = createMockPlayer({ name: 'Alice', testsPassed: 0 });
      const p2 = createMockPlayer({ name: 'Bob', testsPassed: 0 });

      const outcome = determineTimeoutOutcome(p1, p2);

      expect(outcome.type).toBe('tie');
      expect(outcome.reason).toBe('both_zero');
      expect(outcome.eloChange).toBe(false);
    });

    test('scenario: P1 passes 1/10, P2 passes 0/10 - P1 wins', () => {
      const p1 = createMockPlayer({ name: 'Alice', testsPassed: 1 });
      const p2 = createMockPlayer({ name: 'Bob', testsPassed: 0 });

      const outcome = determineTimeoutOutcome(p1, p2);

      expect(outcome.type).toBe('partial_credit');
      expect(outcome.winner.name).toBe('Alice');
    });

    test('scenario: handles undefined testsPassed gracefully', () => {
      const p1 = createMockPlayer({ name: 'Alice' });
      delete p1.testsPassed; // Simulate missing field
      const p2 = createMockPlayer({ name: 'Bob', testsPassed: 5 });

      const outcome = determineTimeoutOutcome(p1, p2);

      expect(outcome.type).toBe('partial_credit');
      expect(outcome.winner.name).toBe('Bob');
    });
  });

  describe('ELO calculation for partial credit', () => {
    test('full flow: 7 vs 3 tests with equal ratings', () => {
      const winner = createMockPlayer({ testsPassed: 7, rating: 1000, totalGames: 20 });
      const loser = createMockPlayer({ testsPassed: 3, rating: 1000, totalGames: 20 });
      const totalTests = 10;

      const result = elo.calculatePartialCreditRatings(
        { rating: winner.rating, totalGames: winner.totalGames, testsPassed: winner.testsPassed },
        { rating: loser.rating, totalGames: loser.totalGames, testsPassed: loser.testsPassed },
        totalTests
      );

      // 4 test difference / 10 total = 0.4 scale factor
      // multiplier = 0.5 + 0.5 * 0.4 = 0.7
      expect(result.scaleFactor).toBe(0.7);
      expect(result.testDifference).toBe(4);
      expect(result.winner.change).toBeGreaterThan(0);
      expect(result.loser.change).toBeLessThan(0);
      expect(Math.abs(result.winner.change)).toBe(Math.abs(result.loser.change));
    });

    test('full flow: upset victory (lower rated beats higher rated)', () => {
      const winner = createMockPlayer({ testsPassed: 6, rating: 900, totalGames: 20 });
      const loser = createMockPlayer({ testsPassed: 4, rating: 1200, totalGames: 20 });
      const totalTests = 10;

      const result = elo.calculatePartialCreditRatings(
        { rating: winner.rating, totalGames: winner.totalGames, testsPassed: winner.testsPassed },
        { rating: loser.rating, totalGames: loser.totalGames, testsPassed: loser.testsPassed },
        totalTests
      );

      // Upset should give larger ELO swing
      expect(result.winner.change).toBeGreaterThan(10);
      expect(result.winner.newRating).toBeGreaterThan(winner.rating);
      expect(result.loser.newRating).toBeLessThan(loser.rating);
    });

    test('full flow: close match (1 test difference)', () => {
      const winner = createMockPlayer({ testsPassed: 5, rating: 1000, totalGames: 20 });
      const loser = createMockPlayer({ testsPassed: 4, rating: 1000, totalGames: 20 });
      const totalTests = 10;

      const result = elo.calculatePartialCreditRatings(
        { rating: winner.rating, totalGames: winner.totalGames, testsPassed: winner.testsPassed },
        { rating: loser.rating, totalGames: loser.totalGames, testsPassed: loser.testsPassed },
        totalTests
      );

      // 1 test = 10% = 55% multiplier
      expect(result.scaleFactor).toBe(0.55);
      // Minimum change of 1
      expect(result.winner.change).toBeGreaterThanOrEqual(1);
    });

    test('full flow: maximum difference (all vs none)', () => {
      const winner = createMockPlayer({ testsPassed: 10, rating: 1000, totalGames: 20 });
      const loser = createMockPlayer({ testsPassed: 0, rating: 1000, totalGames: 20 });
      const totalTests = 10;

      const result = elo.calculatePartialCreditRatings(
        { rating: winner.rating, totalGames: winner.totalGames, testsPassed: winner.testsPassed },
        { rating: loser.rating, totalGames: loser.totalGames, testsPassed: loser.testsPassed },
        totalTests
      );

      // 10 test difference = 100% = full ELO
      expect(result.scaleFactor).toBe(1);
      expect(result.testDifference).toBe(10);
    });
  });

  describe('socket event payload structure', () => {
    // Verify the structure of the socket event matches frontend expectations
    function createPartialCreditEvent(battle, winner, loser, eloResults) {
      const totalTests = battle.problem.testCases.length;
      return {
        message: `Time's up! ${winner.name} wins with ${winner.testsPassed || 0}/${totalTests} tests vs ${loser.testsPassed || 0}/${totalTests}!`,
        finishedAt: battle.finishedAt,
        isPartialCredit: true,
        winner: winner.id,
        loser: loser.id,
        winnerName: winner.name,
        loserName: loser.name,
        testProgress: {
          winner: winner.testsPassed || 0,
          loser: loser.testsPassed || 0,
          total: totalTests
        },
        ratingChanges: {
          winner: {
            change: eloResults.winner.change,
            newRating: eloResults.winner.newRating
          },
          loser: {
            change: eloResults.loser.change,
            newRating: eloResults.loser.newRating
          }
        },
        scaleFactor: eloResults.scaleFactor
      };
    }

    test('event payload has all required fields', () => {
      const battle = createMockBattle({ totalTests: 10 });
      const winner = createMockPlayer({ name: 'Alice', testsPassed: 7 });
      const loser = createMockPlayer({ name: 'Bob', testsPassed: 3 });
      const eloResults = elo.calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 7 },
        { rating: 1000, totalGames: 20, testsPassed: 3 },
        10
      );

      const event = createPartialCreditEvent(battle, winner, loser, eloResults);

      // Verify required fields for frontend
      expect(event).toHaveProperty('message');
      expect(event).toHaveProperty('isPartialCredit', true);
      expect(event).toHaveProperty('winner');
      expect(event).toHaveProperty('loser');
      expect(event).toHaveProperty('winnerName', 'Alice');
      expect(event).toHaveProperty('loserName', 'Bob');
      expect(event.testProgress).toHaveProperty('winner', 7);
      expect(event.testProgress).toHaveProperty('loser', 3);
      expect(event.testProgress).toHaveProperty('total', 10);
      expect(event.ratingChanges.winner).toHaveProperty('change');
      expect(event.ratingChanges.loser).toHaveProperty('change');
      expect(event).toHaveProperty('scaleFactor', 0.7);
    });

    test('event message format is correct', () => {
      const battle = createMockBattle({ totalTests: 10 });
      const winner = createMockPlayer({ name: 'Alice', testsPassed: 8 });
      const loser = createMockPlayer({ name: 'Bob', testsPassed: 2 });
      const eloResults = elo.calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 8 },
        { rating: 1000, totalGames: 20, testsPassed: 2 },
        10
      );

      const event = createPartialCreditEvent(battle, winner, loser, eloResults);

      expect(event.message).toBe("Time's up! Alice wins with 8/10 tests vs 2/10!");
    });
  });

  describe('edge cases and defensive coding', () => {
    test('handles player with undefined testsPassed', () => {
      const player = createMockPlayer({});
      delete player.testsPassed;

      // Simulate defensive coding from server.js
      const testsPassed = player.testsPassed || 0;

      expect(testsPassed).toBe(0);
    });

    test('handles null player gracefully', () => {
      const p1 = createMockPlayer({ testsPassed: 5 });
      const p2 = null;

      // Simulate defensive coding
      const p2Tests = p2?.testsPassed || 0;

      expect(p2Tests).toBe(0);
    });

    test('handles zero total tests', () => {
      const result = elo.calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 0 },
        { rating: 1000, totalGames: 20, testsPassed: 0 },
        0
      );

      // Should not throw, should return sensible defaults
      expect(result.scaleFactor).toBe(0.5);
      expect(result.testDifference).toBe(0);
    });

    test('rating bounds are enforced (100-3500)', () => {
      // Test lower bound
      const lowResult = elo.calculatePartialCreditRatings(
        { rating: 1500, totalGames: 20, testsPassed: 10 },
        { rating: 100, totalGames: 20, testsPassed: 0 },
        10
      );
      expect(lowResult.loser.newRating).toBe(100);

      // Test upper bound
      const highResult = elo.calculatePartialCreditRatings(
        { rating: 3500, totalGames: 20, testsPassed: 10 },
        { rating: 1000, totalGames: 20, testsPassed: 0 },
        10
      );
      expect(highResult.winner.newRating).toBe(3500);
    });
  });
});
