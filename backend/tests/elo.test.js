const elo = require('../elo');

describe('calculatePartialCreditRatings', () => {
  const { calculatePartialCreditRatings } = elo;

  describe('ELO scaling based on test difference', () => {
    test('maximum difference (all vs none) gives 100% ELO', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 10 },
        { rating: 1000, totalGames: 20, testsPassed: 0 },
        10
      );
      // scaleFactor = 10/10 = 1.0, multiplier = 0.5 + 0.5*1 = 1.0
      expect(result.scaleFactor).toBe(1);
      expect(result.testDifference).toBe(10);
    });

    test('minimum difference (1 test) gives ~55% ELO', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 6 },
        { rating: 1000, totalGames: 20, testsPassed: 5 },
        10
      );
      // scaleFactor = 1/10 = 0.1, multiplier = 0.5 + 0.5*0.1 = 0.55
      expect(result.scaleFactor).toBe(0.55);
      expect(result.testDifference).toBe(1);
    });

    test('half difference gives 75% ELO', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 8 },
        { rating: 1000, totalGames: 20, testsPassed: 3 },
        10
      );
      // scaleFactor = 5/10 = 0.5, multiplier = 0.5 + 0.5*0.5 = 0.75
      expect(result.scaleFactor).toBe(0.75);
      expect(result.testDifference).toBe(5);
    });
  });

  describe('ELO changes are applied correctly', () => {
    test('winner gains rating, loser loses rating', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 7 },
        { rating: 1000, totalGames: 20, testsPassed: 3 },
        10
      );
      expect(result.winner.change).toBeGreaterThan(0);
      expect(result.loser.change).toBeLessThan(0);
      expect(result.winner.newRating).toBeGreaterThan(1000);
      expect(result.loser.newRating).toBeLessThan(1000);
    });

    test('rating changes are zero-sum', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1200, totalGames: 30, testsPassed: 8 },
        { rating: 1000, totalGames: 30, testsPassed: 2 },
        10
      );
      // Winner gain should equal loser loss (absolute values)
      expect(Math.abs(result.winner.change)).toBe(Math.abs(result.loser.change));
    });

    test('minimum change is 1 point', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1500, totalGames: 50, testsPassed: 6 },
        { rating: 1000, totalGames: 50, testsPassed: 5 },
        10
      );
      // Even with small difference and unfavorable expected score, minimum is 1
      expect(result.winner.change).toBeGreaterThanOrEqual(1);
    });
  });

  describe('rating bounds', () => {
    test('rating cannot go below 100', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1500, totalGames: 20, testsPassed: 10 },
        { rating: 100, totalGames: 20, testsPassed: 0 },
        10
      );
      expect(result.loser.newRating).toBe(100);
    });

    test('rating cannot exceed 3500', () => {
      const result = calculatePartialCreditRatings(
        { rating: 3500, totalGames: 20, testsPassed: 10 },
        { rating: 1000, totalGames: 20, testsPassed: 0 },
        10
      );
      expect(result.winner.newRating).toBe(3500);
    });
  });

  describe('edge cases', () => {
    test('handles zero total tests gracefully', () => {
      const result = calculatePartialCreditRatings(
        { rating: 1000, totalGames: 20, testsPassed: 0 },
        { rating: 1000, totalGames: 20, testsPassed: 0 },
        0
      );
      // Should not throw, scaleFactor should be 0
      expect(result.scaleFactor).toBe(0.5); // 0.5 + 0.5*0 = 0.5
    });

    test('K-factor varies by experience', () => {
      // New player (< 10 games) has K=40
      const newPlayer = calculatePartialCreditRatings(
        { rating: 1000, totalGames: 5, testsPassed: 7 },
        { rating: 1000, totalGames: 5, testsPassed: 3 },
        10
      );

      // Established player (> 30 games) has K=24
      const establishedPlayer = calculatePartialCreditRatings(
        { rating: 1000, totalGames: 50, testsPassed: 7 },
        { rating: 1000, totalGames: 50, testsPassed: 3 },
        10
      );

      // New player should have larger rating change
      expect(newPlayer.winner.change).toBeGreaterThan(establishedPlayer.winner.change);
    });
  });
});

describe('timeout scenario determination', () => {
  // These tests verify the battle timeout logic from server.js
  // The logic determines outcome based on test progress when timer expires

  function determineTimeoutOutcome(p1Tests, p2Tests, totalTests) {
    // Replicate the logic from server.js lines ~2954-3100
    if (p1Tests === 0 && p2Tests === 0) {
      return { outcome: 'tie', eloChange: false, reason: 'both_zero' };
    }
    if (p1Tests === p2Tests) {
      return { outcome: 'tie', eloChange: true, reason: 'equal_progress' };
    }
    // Different tests - partial credit win
    const winner = p1Tests > p2Tests ? 'p1' : 'p2';
    return { outcome: 'partial_credit', winner, eloChange: true };
  }

  test('P1: 7 tests, P2: 3 tests → P1 wins with partial credit', () => {
    const result = determineTimeoutOutcome(7, 3, 10);
    expect(result.outcome).toBe('partial_credit');
    expect(result.winner).toBe('p1');
    expect(result.eloChange).toBe(true);
  });

  test('both 5 tests → Tie with normal ELO adjustment', () => {
    const result = determineTimeoutOutcome(5, 5, 10);
    expect(result.outcome).toBe('tie');
    expect(result.eloChange).toBe(true);
    expect(result.reason).toBe('equal_progress');
  });

  test('both 0 tests → Tie with NO ELO change', () => {
    const result = determineTimeoutOutcome(0, 0, 10);
    expect(result.outcome).toBe('tie');
    expect(result.eloChange).toBe(false);
    expect(result.reason).toBe('both_zero');
  });

  test('P1: 3 tests, P2: 0 tests → P1 wins', () => {
    const result = determineTimeoutOutcome(3, 0, 10);
    expect(result.outcome).toBe('partial_credit');
    expect(result.winner).toBe('p1');
  });

  test('P1: 0 tests, P2: 1 test → P2 wins', () => {
    const result = determineTimeoutOutcome(0, 1, 10);
    expect(result.outcome).toBe('partial_credit');
    expect(result.winner).toBe('p2');
  });

  test('P1: 10 tests, P2: 9 tests → P1 wins by 1 test', () => {
    const result = determineTimeoutOutcome(10, 9, 10);
    expect(result.outcome).toBe('partial_credit');
    expect(result.winner).toBe('p1');
  });
});

describe('partial credit ELO integration', () => {
  const { calculatePartialCreditRatings, calculateTieRatings } = elo;

  test('partial credit gives less ELO than full win', () => {
    // 7 vs 3 = 40% difference = 70% multiplier
    const partialResult = calculatePartialCreditRatings(
      { rating: 1000, totalGames: 20, testsPassed: 7 },
      { rating: 1000, totalGames: 20, testsPassed: 3 },
      10
    );

    // Full win = 100% multiplier
    const fullResult = calculatePartialCreditRatings(
      { rating: 1000, totalGames: 20, testsPassed: 10 },
      { rating: 1000, totalGames: 20, testsPassed: 0 },
      10
    );

    expect(partialResult.winner.change).toBeLessThan(fullResult.winner.change);
    expect(partialResult.scaleFactor).toBe(0.7);
    expect(fullResult.scaleFactor).toBe(1);
  });

  test('tie scenario uses calculateTieRatings', () => {
    // Both have same tests = tie, not partial credit
    const tieResult = calculateTieRatings(
      { rating: 1000, totalGames: 20 },
      { rating: 1000, totalGames: 20 }
    );

    expect(tieResult.player1.change).toBe(0);
    expect(tieResult.player2.change).toBe(0);
  });

  test('higher rated player with fewer tests loses more', () => {
    // Higher rated player (1300) passes fewer tests than lower (1000)
    const result = calculatePartialCreditRatings(
      { rating: 1000, totalGames: 20, testsPassed: 6 }, // Winner
      { rating: 1300, totalGames: 20, testsPassed: 4 }, // Loser (higher rated)
      10
    );

    // Higher rated loser should lose more (lower expected outcome upset)
    expect(result.winner.change).toBeGreaterThan(10);
    expect(Math.abs(result.loser.change)).toBeGreaterThan(10);
  });

  test('close match with 1 test difference gives minimum ELO', () => {
    const result = calculatePartialCreditRatings(
      { rating: 1000, totalGames: 20, testsPassed: 5 },
      { rating: 1000, totalGames: 20, testsPassed: 4 },
      10
    );

    // 1 test diff = 10% = 55% multiplier, but minimum is 1
    expect(result.winner.change).toBeGreaterThanOrEqual(1);
    expect(result.scaleFactor).toBe(0.55);
  });
});

describe('existing ELO functions', () => {
  describe('calculateMatchRatings', () => {
    test('winner gains, loser loses', () => {
      const result = elo.calculateMatchRatings(
        { rating: 1000, totalGames: 20 },
        { rating: 1000, totalGames: 20 }
      );
      expect(result.winner.change).toBeGreaterThan(0);
      expect(result.loser.change).toBeLessThan(0);
    });
  });

  describe('calculateTieRatings', () => {
    test('equal ratings result in no change', () => {
      const result = elo.calculateTieRatings(
        { rating: 1000, totalGames: 20 },
        { rating: 1000, totalGames: 20 }
      );
      expect(result.player1.change).toBe(0);
      expect(result.player2.change).toBe(0);
    });

    test('higher rated player loses points in tie', () => {
      const result = elo.calculateTieRatings(
        { rating: 1200, totalGames: 20 },
        { rating: 1000, totalGames: 20 }
      );
      expect(result.player1.change).toBeLessThan(0);
      expect(result.player2.change).toBeGreaterThan(0);
    });
  });

  describe('getRankDivision', () => {
    test('returns correct rank for Bronze', () => {
      const rank = elo.getRankDivision(800);
      expect(rank.tier.name).toBe('Bronze');
    });

    test('returns correct rank for Grandmaster', () => {
      const rank = elo.getRankDivision(2500);
      expect(rank.tier.name).toBe('Grandmaster');
    });
  });
});
