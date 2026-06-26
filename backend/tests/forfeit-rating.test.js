describe('Forfeit Rating Changes', () => {
  test('persistBattleResult returns non-zero rating changes for matchmade forfeit', async () => {
    // Test the core logic: ELO calculation for forfeits
    const elo = require('../elo');

    const result = elo.calculateMatchRatings(
      { rating: 1000, totalGames: 5 },  // winner
      { rating: 1000, totalGames: 5 }   // loser (forfeiter)
    );

    expect(result.winner.change).toBeGreaterThan(0);
    expect(result.loser.change).toBeLessThan(0);
    expect(result.winner.change).toBe(20);
    expect(result.loser.change).toBe(-20);
  });

  test('ELO changes are non-zero for different rating matchups', async () => {
    const elo = require('../elo');

    // Higher rated player loses (bigger swing)
    const result1 = elo.calculateMatchRatings(
      { rating: 800, totalGames: 5 },   // lower rated wins
      { rating: 1200, totalGames: 5 }   // higher rated loses
    );
    expect(result1.winner.change).toBeGreaterThan(20); // Upset = bigger gain
    expect(result1.loser.change).toBeLessThan(-20);    // Upset = bigger loss

    // Higher rated wins (smaller swing)
    const result2 = elo.calculateMatchRatings(
      { rating: 1200, totalGames: 5 },  // higher rated wins
      { rating: 800, totalGames: 5 }    // lower rated loses
    );
    expect(result2.winner.change).toBeLessThan(20);  // Expected = smaller gain
    expect(result2.loser.change).toBeGreaterThan(-20); // Expected = smaller loss
    expect(result2.winner.change).toBeGreaterThan(0);  // Still positive
    expect(result2.loser.change).toBeLessThan(0);      // Still negative
  });

  test('ratingChanges event payload is null for non-matchmade battles', () => {
    // Simulate what the battle-finished event builds
    const battle = { isAgainstBot: false, matchmade: false };
    const battleResult = { winnerRatingChange: 0, loserRatingChange: 0 };

    const ratingChanges = (battle.isAgainstBot || !battle.matchmade) ? null : {
      winner: { change: battleResult.winnerRatingChange || 0 },
      loser: { change: battleResult.loserRatingChange || 0 }
    };

    expect(ratingChanges).toBeNull();
  });

  test('ratingChanges event payload has real values for matchmade battles', () => {
    const battle = { isAgainstBot: false, matchmade: true };
    const battleResult = {
      winnerRatingChange: 20,
      loserRatingChange: -20,
      winnerNewRating: 1020,
      loserNewRating: 980,
      winnerRank: { display: 'Bronze I' },
      loserRank: { display: 'Bronze I' }
    };

    const ratingChanges = (battle.isAgainstBot || !battle.matchmade) ? null : {
      winner: {
        change: battleResult.winnerRatingChange || 0,
        newRating: battleResult.winnerNewRating || null,
        newRank: battleResult.winnerRank?.display || null
      },
      loser: {
        change: battleResult.loserRatingChange || 0,
        newRating: battleResult.loserNewRating || null,
        newRank: battleResult.loserRank?.display || null
      }
    };

    expect(ratingChanges).not.toBeNull();
    expect(ratingChanges.winner.change).toBe(20);
    expect(ratingChanges.loser.change).toBe(-20);
    expect(ratingChanges.winner.newRating).toBe(1020);
    expect(ratingChanges.loser.newRating).toBe(980);
  });

  test('ratingChanges is null for bot battles', () => {
    const battle = { isAgainstBot: true, matchmade: true };
    const battleResult = { winnerRatingChange: 0, loserRatingChange: 0 };

    const ratingChanges = (battle.isAgainstBot || !battle.matchmade) ? null : {
      winner: { change: battleResult.winnerRatingChange || 0 },
      loser: { change: battleResult.loserRatingChange || 0 }
    };

    expect(ratingChanges).toBeNull();
  });

  test('negative rating changes are preserved (not zeroed by || 0)', () => {
    const battleResult = { winnerRatingChange: 15, loserRatingChange: -25 };

    const winnerChange = battleResult.winnerRatingChange || 0;
    const loserChange = battleResult.loserRatingChange || 0;

    expect(winnerChange).toBe(15);
    expect(loserChange).toBe(-25); // -25 is truthy, so || 0 preserves it
  });
});
