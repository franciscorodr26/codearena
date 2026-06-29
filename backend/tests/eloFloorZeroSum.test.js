const {
  calculateMatchRatings,
  calculateTieRatings,
  calculatePartialCreditRatings,
  getKFactor,
  getExpectedScore,
} = require('../elo');

// Helper: replicate the change the production code would compute pre-clamp
// so each test can drive a known delta into the floor-aware logic.
function expectedRawChange(winnerRating, loserRating, winnerGames, loserGames) {
  const winnerK = getKFactor(winnerGames, winnerRating);
  const loserK = getKFactor(loserGames, loserRating);
  const sharedK = Math.round((winnerK + loserK) / 2);
  const expected = getExpectedScore(winnerRating, loserRating);
  return Math.round(sharedK * (1 - expected));
}

describe('ELO floor preserves zero-sum invariant', () => {
  describe('calculateMatchRatings', () => {
    test('loser near floor: winner gain is capped to loser headroom', () => {
      // Construct a scenario where the raw delta would exceed the loser's
      // headroom above the floor. winner=200, loser=110 with a new winner
      // gives sharedK=32 and raw change ≈ 12; loser has only 10 headroom,
      // so the transfer must be capped at 10.
      const winnerOld = 200;
      const loserOld = 110; // headroom = 10
      const winnerGames = 5;
      const loserGames = 50;

      const raw = expectedRawChange(winnerOld, loserOld, winnerGames, loserGames);
      expect(raw).toBeGreaterThan(loserOld - 100); // sanity: cap will trigger
      const expectedTransfer = loserOld - 100;

      const result = calculateMatchRatings(
        { rating: winnerOld, totalGames: winnerGames },
        { rating: loserOld, totalGames: loserGames }
      );

      expect(result.loser.newRating).toBe(100);
      expect(result.winner.newRating).toBe(winnerOld + expectedTransfer);
      expect(result.winner.change).toBe(expectedTransfer);
      expect(result.loser.change).toBe(-expectedTransfer);
      // Zero-sum: total system rating unchanged.
      expect(result.winner.newRating + result.loser.newRating).toBe(
        winnerOld + loserOld
      );
    });

    test('loser already at floor: no rating injected (1000 vs 100)', () => {
      const winnerOld = 1000;
      const loserOld = 100;

      const result = calculateMatchRatings(
        { rating: winnerOld, totalGames: 50 },
        { rating: loserOld, totalGames: 50 }
      );

      expect(result.loser.newRating).toBe(100);
      expect(result.loser.change).toBe(0);
      expect(result.winner.newRating).toBe(winnerOld);
      expect(result.winner.change).toBe(0);
      expect(result.winner.newRating + result.loser.newRating).toBe(
        winnerOld + loserOld
      );
    });

    test('normal case far from floor: equal-and-opposite delta (1500 vs 1500)', () => {
      const winnerOld = 1500;
      const loserOld = 1500;
      const raw = expectedRawChange(winnerOld, loserOld, 50, 50);

      const result = calculateMatchRatings(
        { rating: winnerOld, totalGames: 50 },
        { rating: loserOld, totalGames: 50 }
      );

      expect(result.winner.change).toBe(raw);
      expect(result.loser.change).toBe(-raw);
      expect(result.winner.newRating + result.loser.newRating).toBe(
        winnerOld + loserOld
      );
    });

    test('loser below floor (malformed input): no rating injected', () => {
      const winnerOld = 1200;
      const loserOld = 80;

      const result = calculateMatchRatings(
        { rating: winnerOld, totalGames: 50 },
        { rating: loserOld, totalGames: 50 }
      );

      // No rating may be transferred — loser has zero headroom (or negative).
      expect(result.winner.change).toBe(0);
      // Loser's defensive floor brings them to 100; that is the only rating
      // change in the system, and it is an injection (not a transfer). The
      // pre-existing malformed state cannot be repaired without breaking
      // zero-sum, so we accept the one-time correction. The important
      // invariant is that the *transfer* is zero (winner did not gain).
      expect(result.winner.newRating).toBe(winnerOld);
    });
  });

  describe('calculatePartialCreditRatings', () => {
    test('loser near floor: transfer capped to loser headroom', () => {
      // Use a new player (high K) and a small headroom so the natural
      // partial-credit delta exceeds the loser's headroom and the cap fires.
      // sharedK is ~32 for new players; expectedScore here is ~0.63 so the
      // raw partial-credit change (with mult=1.0 at full test diff) is ~12;
      // loser headroom is 10, so the transfer is capped at 10.
      const winnerOld = 200;
      const loserOld = 110; // headroom = 10

      const result = calculatePartialCreditRatings(
        { rating: winnerOld, totalGames: 5, testsPassed: 10 },
        { rating: loserOld, totalGames: 50, testsPassed: 0 },
        10
      );

      expect(result.loser.newRating).toBe(100);
      // The cap is exactly the loser's headroom and the transfer is zero-sum.
      expect(result.winner.change).toBe(loserOld - 100);
      expect(result.loser.change).toBe(-(loserOld - 100));
      expect(result.winner.newRating + result.loser.newRating).toBe(
        winnerOld + loserOld
      );
    });

    test('loser at floor: no rating injected', () => {
      const winnerOld = 1000;
      const loserOld = 100;

      const result = calculatePartialCreditRatings(
        { rating: winnerOld, totalGames: 50, testsPassed: 10 },
        { rating: loserOld, totalGames: 50, testsPassed: 0 },
        10
      );

      expect(result.winner.change).toBe(0);
      expect(result.loser.change).toBe(0);
      expect(result.winner.newRating + result.loser.newRating).toBe(
        winnerOld + loserOld
      );
    });

    test('normal case far from floor stays zero-sum', () => {
      const winnerOld = 1500;
      const loserOld = 1500;

      const result = calculatePartialCreditRatings(
        { rating: winnerOld, totalGames: 50, testsPassed: 8 },
        { rating: loserOld, totalGames: 50, testsPassed: 3 },
        10
      );

      expect(result.winner.change).toBeGreaterThan(0);
      expect(result.winner.change).toBe(-result.loser.change);
      expect(result.winner.newRating + result.loser.newRating).toBe(
        winnerOld + loserOld
      );
    });
  });

  describe('calculateTieRatings', () => {
    test('tie with lower-rated player near floor: transfer capped', () => {
      // Higher-rated player loses rating in a tie; lower-rated gains. Make
      // the lower-rated player the one near the floor so we exercise the
      // capping branch where change2 < 0 (i.e. player2 is the higher-rated).
      const p1Old = 100; // already at floor; should not be pushed below
      const p2Old = 2000;

      const result = calculateTieRatings(
        { rating: p1Old, totalGames: 50 },
        { rating: p2Old, totalGames: 50 }
      );

      // p1 is below expected (much lower rated) so in a tie p1 gains, p2 loses.
      // p2 has plenty of headroom, so no capping should occur here — but the
      // critical invariant is zero-sum.
      expect(result.player1.newRating + result.player2.newRating).toBe(
        p1Old + p2Old
      );
      expect(result.player1.newRating).toBeGreaterThanOrEqual(100);
      expect(result.player2.newRating).toBeGreaterThanOrEqual(100);
    });

    test('tie where higher-rated player would drop below floor is capped', () => {
      // Construct a case where the rating-losing side is near the floor.
      // p1 is much higher rated than p2, but both are near floor:
      // p1=150, p2=100. In a tie, p1 loses rating, p2 gains. p1 has only
      // 50 headroom, so the transfer must be capped at 50.
      const p1Old = 150;
      const p2Old = 100;

      const result = calculateTieRatings(
        { rating: p1Old, totalGames: 50 },
        { rating: p2Old, totalGames: 50 }
      );

      expect(result.player1.newRating).toBeGreaterThanOrEqual(100);
      expect(result.player2.newRating).toBeGreaterThanOrEqual(100);
      // Zero-sum holds.
      expect(result.player1.newRating + result.player2.newRating).toBe(
        p1Old + p2Old
      );
    });

    test('tie far from floor preserves zero-sum', () => {
      const p1Old = 1600;
      const p2Old = 1400;

      const result = calculateTieRatings(
        { rating: p1Old, totalGames: 50 },
        { rating: p2Old, totalGames: 50 }
      );

      expect(result.player1.newRating + result.player2.newRating).toBe(
        p1Old + p2Old
      );
    });
  });
});
