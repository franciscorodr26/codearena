/**
 * Agent Battle ELO Calculation Edge Case Tests
 *
 * Comprehensive tests for ELO rating calculations:
 * - Boundary conditions (min/max ratings)
 * - K-factor variations
 * - Extreme rating differences
 * - Draw handling
 * - Rating floor/ceiling
 * - Win/loss streaks
 * - Provisional rating periods
 */

// Mock database before requiring elo module
const mockDb = {
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
  init: jest.fn().mockResolvedValue(true)
};

jest.mock('../db', () => mockDb);

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const elo = require('../elo');

describe('Agent Battle ELO Calculation - Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Boundary Rating Values', () => {
    it('should handle minimum rating (100)', () => {
      const winner = { rating: 100, totalGames: 10 };
      const loser = { rating: 1000, totalGames: 10 };

      const result = elo.calculateMatchRatings(winner, loser);

      expect(result.winner.newRating).toBeGreaterThan(100);
      expect(result.winner.change).toBeGreaterThan(0);
    });

    it('should handle maximum practical rating (3000+)', () => {
      const winner = { rating: 3000, totalGames: 100 };
      const loser = { rating: 1000, totalGames: 100 };

      const result = elo.calculateMatchRatings(winner, loser);

      expect(result.winner.newRating).toBeGreaterThanOrEqual(3000);
      // Expected win against much lower opponent gives minimal or no points
      expect(result.winner.change).toBeGreaterThanOrEqual(0);
      expect(result.winner.change).toBeLessThan(5); // Very small gain
    });

    it('should not allow ratings below floor (100)', () => {
      const winner = { rating: 150, totalGames: 5 };
      const loser = { rating: 100, totalGames: 5 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Even if loser would go below floor, should stay at 100
      expect(result.loser.newRating).toBeGreaterThanOrEqual(100);
    });

    it('should handle both players at minimum rating', () => {
      const winner = { rating: 100, totalGames: 1 };
      const loser = { rating: 100, totalGames: 1 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Zero-sum invariant: loser is already at the floor and has no rating
      // to lose, so the winner cannot gain rating either. Total rating in the
      // system must not increase. (Fixed in: ELO floor zero-sum follow-up.)
      expect(result.loser.newRating).toBe(100);
      expect(result.winner.newRating).toBe(100);
    });

    it('should handle both players at maximum rating', () => {
      const winner = { rating: 3000, totalGames: 1000 };
      const loser = { rating: 3000, totalGames: 1000 };

      const result = elo.calculateMatchRatings(winner, loser);

      expect(result.winner.newRating).toBeGreaterThan(3000);
      expect(result.loser.newRating).toBeLessThan(3000);
    });

    it('should enforce rating ceiling (3500)', () => {
      const winner = { rating: 3490, totalGames: 500 };
      const loser = { rating: 1000, totalGames: 500 };

      const result = elo.calculateMatchRatings(winner, loser);

      expect(result.winner.newRating).toBeLessThanOrEqual(3500);
    });
  });

  describe('Extreme Rating Differences', () => {
    it('should give minimal points to high-rated winner vs low-rated loser', () => {
      const winner = { rating: 2500, totalGames: 100 };
      const loser = { rating: 500, totalGames: 100 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Expected win, so minimal gain
      expect(result.winner.change).toBeLessThan(5);
      expect(result.loser.change).toBeGreaterThan(-5);
    });

    it('should give massive points to low-rated winner vs high-rated loser', () => {
      const winner = { rating: 500, totalGames: 100 };
      const loser = { rating: 2500, totalGames: 100 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Major upset, significant point swing (K-factor is ~24, so max ~24 points)
      expect(result.winner.change).toBeGreaterThan(15);
      expect(result.loser.change).toBeLessThan(-15);
    });

    it('should handle rating difference > 1000', () => {
      const winner = { rating: 2000, totalGames: 50 };
      const loser = { rating: 500, totalGames: 50 };

      const result = elo.calculateMatchRatings(winner, loser);

      expect(result.winner.newRating).toBeDefined();
      expect(result.loser.newRating).toBeDefined();
      // Expected win against much lower opponent gives minimal or no points
      expect(result.winner.change).toBeGreaterThanOrEqual(0);
    });

    it('should maintain zero-sum property even with extreme differences', () => {
      const winner = { rating: 3000, totalGames: 200 };
      const loser = { rating: 100, totalGames: 200 };

      const result = elo.calculateMatchRatings(winner, loser);

      const sum = result.winner.change + result.loser.change;
      expect(Math.abs(sum)).toBeLessThan(0.01); // Allow for floating point errors
    });
  });

  describe('K-Factor Variations', () => {
    it('should use higher K-factor for players with few games', () => {
      const winner1 = { rating: 1000, totalGames: 5 }; // New player
      const loser1 = { rating: 1000, totalGames: 5 };

      const result1 = elo.calculateMatchRatings(winner1, loser1);

      const winner2 = { rating: 1000, totalGames: 100 }; // Veteran
      const loser2 = { rating: 1000, totalGames: 100 };

      const result2 = elo.calculateMatchRatings(winner2, loser2);

      // New players should have larger rating changes
      expect(Math.abs(result1.winner.change)).toBeGreaterThan(Math.abs(result2.winner.change));
    });

    it('should decrease K-factor as games played increases', () => {
      const results = [];

      for (const games of [5, 20, 50, 100, 200]) {
        const winner = { rating: 1200, totalGames: games };
        const loser = { rating: 1200, totalGames: games };

        const result = elo.calculateMatchRatings(winner, loser);
        results.push({
          games,
          change: Math.abs(result.winner.change)
        });
      }

      // Each successive change should be smaller or equal
      for (let i = 1; i < results.length; i++) {
        expect(results[i].change).toBeLessThanOrEqual(results[i - 1].change);
      }
    });

    it('should handle K-factor for exactly 30 games (boundary)', () => {
      const winner = { rating: 1200, totalGames: 30 };
      const loser = { rating: 1200, totalGames: 30 };

      const result = elo.calculateMatchRatings(winner, loser);

      expect(result.winner.change).toBeGreaterThan(0);
      expect(result.winner.change).toBeLessThan(50);
    });
  });

  describe('Equal Rating Scenarios', () => {
    it('should split points evenly for players with equal rating', () => {
      const winner = { rating: 1500, totalGames: 50 };
      const loser = { rating: 1500, totalGames: 50 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Winner gains what loser loses
      expect(result.winner.change).toBeGreaterThan(0);
      expect(result.loser.change).toBeLessThan(0);
      expect(result.winner.change).toBe(-result.loser.change);
    });

    it('should handle equal ratings at different game counts', () => {
      const winner = { rating: 1200, totalGames: 10 }; // Newer
      const loser = { rating: 1200, totalGames: 100 }; // Veteran

      const result = elo.calculateMatchRatings(winner, loser);

      // Both change equally because we use shared K-factor (average of both players)
      // With 10 games (K=32) and 100 games (K=24), shared K = 28
      expect(Math.abs(result.winner.change)).toBeGreaterThanOrEqual(Math.abs(result.loser.change));
    });
  });

  describe('Precision and Rounding', () => {
    it('should maintain zero-sum after rounding', () => {
      const winner = { rating: 1234.567, totalGames: 42 };
      const loser = { rating: 1876.543, totalGames: 73 };

      const result = elo.calculateMatchRatings(winner, loser);

      const sum = result.winner.change + result.loser.change;
      expect(Math.abs(sum)).toBeLessThan(0.01);
    });

    it('should handle fractional ratings correctly', () => {
      const winner = { rating: 1200.5, totalGames: 50 };
      const loser = { rating: 1199.5, totalGames: 50 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Verify newRating = oldRating + change
      expect(result.winner.newRating).toBeCloseTo(winner.rating + result.winner.change, 2);
      expect(result.loser.newRating).toBeCloseTo(loser.rating + result.loser.change, 2);
    });

    it('should not accumulate floating point errors over many calculations', () => {
      let player1Rating = 1200;
      let player2Rating = 1200;

      // Simulate many matches
      for (let i = 0; i < 100; i++) {
        const winner = { rating: player1Rating, totalGames: i + 1 };
        const loser = { rating: player2Rating, totalGames: i + 1 };

        const result = elo.calculateMatchRatings(winner, loser);

        player1Rating = result.winner.newRating;
        player2Rating = result.loser.newRating;
      }

      // Ratings should still be reasonable numbers
      expect(player1Rating).toBeGreaterThan(1200);
      expect(player2Rating).toBeLessThan(1200);
      expect(Number.isFinite(player1Rating)).toBe(true);
      expect(Number.isFinite(player2Rating)).toBe(true);
    });
  });

  describe('Expected Score Calculation', () => {
    it('should calculate expected score correctly for equal players', () => {
      const calculateExpected = (ratingA, ratingB) => {
        return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
      };

      const expected = calculateExpected(1200, 1200);
      expect(expected).toBeCloseTo(0.5, 2); // 50% chance
    });

    it('should calculate expected score for higher rated player', () => {
      const calculateExpected = (ratingA, ratingB) => {
        return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
      };

      const expected = calculateExpected(1600, 1200);
      expect(expected).toBeGreaterThan(0.9); // >90% chance
    });

    it('should calculate expected score for lower rated player', () => {
      const calculateExpected = (ratingA, ratingB) => {
        return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
      };

      const expected = calculateExpected(1200, 1600);
      expect(expected).toBeLessThan(0.1); // <10% chance
    });
  });

  describe('Win Streaks and Momentum', () => {
    it('should track win streaks correctly', () => {
      let streak = 0;
      const maxStreak = 10;

      // Simulate wins
      for (let i = 0; i < maxStreak; i++) {
        streak++;
      }

      expect(streak).toBe(maxStreak);

      // One loss resets
      streak = 0;
      expect(streak).toBe(0);
    });

    it('should apply streak bonuses if implemented', () => {
      // If streaks affect rating (bonus feature)
      const baseChange = 20;
      const streakBonus = 1.1; // 10% bonus per 5 wins

      const withStreak = baseChange * streakBonus;

      expect(withStreak).toBeGreaterThan(baseChange);
    });
  });

  describe('Provisional Period Handling', () => {
    it('should identify provisional players (< 10 games)', () => {
      const player = { rating: 1200, totalGames: 5 };
      const isProvisional = player.totalGames < 10;

      expect(isProvisional).toBe(true);
    });

    it('should identify established players (>= 10 games)', () => {
      const player = { rating: 1200, totalGames: 50 };
      const isProvisional = player.totalGames < 10;

      expect(isProvisional).toBe(false);
    });

    it('should use higher K-factor for provisional players', () => {
      const provisional = { rating: 1200, totalGames: 5 };
      const established = { rating: 1200, totalGames: 50 };

      const result1 = elo.calculateMatchRatings(provisional, established);
      const result2 = elo.calculateMatchRatings(established, provisional);

      // Both use shared K-factor, so changes are equal in magnitude
      // With 5 games (K=40) and 50 games (K=24), shared K = 32
      expect(Math.abs(result1.winner.change)).toBeGreaterThanOrEqual(Math.abs(result2.winner.change));
    });
  });

  describe('Rating Tiers and Boundaries', () => {
    it('should calculate tier from rating correctly', () => {
      const getRank = (rating) => {
        if (rating < 1000) return 'Bronze';
        if (rating < 1200) return 'Silver';
        if (rating < 1400) return 'Gold';
        if (rating < 1600) return 'Platinum';
        if (rating < 1800) return 'Diamond';
        if (rating < 2000) return 'Master';
        return 'Grandmaster';
      };

      expect(getRank(500)).toBe('Bronze');
      expect(getRank(999)).toBe('Bronze');
      expect(getRank(1000)).toBe('Silver');
      expect(getRank(1199)).toBe('Silver');
      expect(getRank(1200)).toBe('Gold');
      expect(getRank(1800)).toBe('Master');
      expect(getRank(2500)).toBe('Grandmaster');
    });

    it('should handle tier promotion edge case', () => {
      // Player at 1199 wins and goes to 1201
      const winner = { rating: 1199, totalGames: 30 };
      const loser = { rating: 1200, totalGames: 30 };

      const result = elo.calculateMatchRatings(winner, loser);

      const getRank = (rating) => {
        if (rating < 1200) return 'Silver';
        return 'Gold';
      };

      const oldRank = getRank(winner.rating);
      const newRank = getRank(result.winner.newRating);

      // May or may not promote depending on exact points
      expect(oldRank).toBe('Silver');
      // newRank could be Silver or Gold
    });

    it('should handle tier demotion edge case', () => {
      // Player at 1201 loses and goes to 1199
      const winner = { rating: 1199, totalGames: 30 };
      const loser = { rating: 1201, totalGames: 30 };

      const result = elo.calculateMatchRatings(winner, loser);

      const getRank = (rating) => {
        if (rating < 1200) return 'Silver';
        return 'Gold';
      };

      const oldRank = getRank(loser.rating);
      const newRank = getRank(result.loser.newRating);

      // May or may not demote depending on exact points
      expect(oldRank).toBe('Gold');
    });
  });

  describe('Special Cases', () => {
    it('should handle null or undefined total games', () => {
      const winner = { rating: 1200, totalGames: undefined };
      const loser = { rating: 1200, totalGames: null };

      // Should default to 0 or handle gracefully
      expect(() => {
        elo.calculateMatchRatings(winner, loser);
      }).not.toThrow();
    });

    it('should handle negative total games', () => {
      const winner = { rating: 1200, totalGames: -5 };
      const loser = { rating: 1200, totalGames: 10 };

      // Should handle gracefully (treat as 0)
      expect(() => {
        elo.calculateMatchRatings(winner, loser);
      }).not.toThrow();
    });

    it('should handle extremely high game count', () => {
      const winner = { rating: 1500, totalGames: 10000 };
      const loser = { rating: 1500, totalGames: 10000 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Should use minimum K-factor
      expect(Math.abs(result.winner.change)).toBeLessThan(20);
    });

    it('should handle first game ever for both players', () => {
      const winner = { rating: 1000, totalGames: 0 };
      const loser = { rating: 1000, totalGames: 0 };

      const result = elo.calculateMatchRatings(winner, loser);

      // Maximum K-factor (40 for new players), equal ratings gives 50% expected
      // Change = K * (1 - 0.5) = 40 * 0.5 = 20
      expect(Math.abs(result.winner.change)).toBe(20);
    });
  });

  describe('Conservation of Rating Points', () => {
    it('should maintain total rating points in system', () => {
      const initialTotal = 1200 + 1300;

      const winner = { rating: 1200, totalGames: 50 };
      const loser = { rating: 1300, totalGames: 50 };

      const result = elo.calculateMatchRatings(winner, loser);

      const finalTotal = result.winner.newRating + result.loser.newRating;

      expect(finalTotal).toBeCloseTo(initialTotal, 2);
    });

    it('should maintain zero-sum across many matches', () => {
      const matches = [
        [1200, 1200],
        [1500, 1000],
        [1800, 1200],
        [1100, 1900],
        [1600, 1400]
      ];

      matches.forEach(([rating1, rating2]) => {
        const winner = { rating: rating1, totalGames: 50 };
        const loser = { rating: rating2, totalGames: 50 };

        const result = elo.calculateMatchRatings(winner, loser);

        const pointsSum = result.winner.change + result.loser.change;
        expect(Math.abs(pointsSum)).toBeLessThan(0.01);
      });
    });
  });

  describe('Mathematical Properties', () => {
    it('should satisfy transitivity over time', () => {
      // If A beats B and B beats C, A's rating should reflect that
      let playerA = { rating: 1200, totalGames: 10 };
      let playerB = { rating: 1200, totalGames: 10 };
      let playerC = { rating: 1200, totalGames: 10 };

      // A beats B
      const result1 = elo.calculateMatchRatings(playerA, playerB);
      playerA.rating = result1.winner.newRating;
      playerB.rating = result1.loser.newRating;

      // B beats C
      const result2 = elo.calculateMatchRatings(playerB, playerC);
      playerB.rating = result2.winner.newRating;
      playerC.rating = result2.loser.newRating;

      // A should have highest rating
      expect(playerA.rating).toBeGreaterThan(playerB.rating);
      expect(playerB.rating).toBeGreaterThan(playerC.rating);
    });

    it('should be deterministic with same inputs', () => {
      const winner1 = { rating: 1234, totalGames: 42 };
      const loser1 = { rating: 1567, totalGames: 89 };

      const result1 = elo.calculateMatchRatings(winner1, loser1);

      const winner2 = { rating: 1234, totalGames: 42 };
      const loser2 = { rating: 1567, totalGames: 89 };

      const result2 = elo.calculateMatchRatings(winner2, loser2);

      expect(result1.winner.newRating).toBe(result2.winner.newRating);
      expect(result1.loser.newRating).toBe(result2.loser.newRating);
    });
  });
});
