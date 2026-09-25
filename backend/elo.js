// ============================================
// ELO RATING SYSTEM
// ============================================
//
// Implements the Elo rating system for competitive matchmaking
// Reference: https://en.wikipedia.org/wiki/Elo_rating_system

// K-factor determines how much ratings change after each game
// Higher K = more volatile ratings, lower K = more stable
const K_FACTOR = {
  NEW_PLAYER: 40,      // Players with < 10 games
  DEVELOPING: 32,      // Players with 10-30 games
  ESTABLISHED: 24,     // Players with > 30 games
  MASTER: 16           // Players with rating > 2000
};

// Rating thresholds for rank tiers
const RANK_TIERS = {
  BRONZE: { min: 0, max: 1199, name: 'Bronze', color: '#CD7F32', icon: '🥉' },
  SILVER: { min: 1200, max: 1399, name: 'Silver', color: '#C0C0C0', icon: '🥈' },
  GOLD: { min: 1400, max: 1599, name: 'Gold', color: '#FFD700', icon: '🥇' },
  PLATINUM: { min: 1600, max: 1799, name: 'Platinum', color: '#E5E4E2', icon: '💎' },
  DIAMOND: { min: 1800, max: 1999, name: 'Diamond', color: '#B9F2FF', icon: '💠' },
  MASTER: { min: 2000, max: 2199, name: 'Master', color: '#9B59B6', icon: '👑' },
  GRANDMASTER: { min: 2200, max: Infinity, name: 'Grandmaster', color: '#E74C3C', icon: '🏆' }
};

// Matchmaking rating range settings
const MATCHMAKING = {
  INITIAL_RANGE: 100,       // Start by looking for ±100 rating
  RANGE_INCREMENT: 50,      // Expand by 50 every interval
  RANGE_INCREMENT_INTERVAL: 10000, // Every 10 seconds
  MAX_RANGE: 500,           // Maximum rating difference allowed
  MIN_RANGE_AFTER_WAIT: 300 // After 60 seconds, allow wider range
};

/**
 * Calculate expected score (probability of winning)
 * @param {number} playerRating - Rating of the player
 * @param {number} opponentRating - Rating of the opponent
 * @returns {number} Expected score between 0 and 1
 */
function getExpectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

/**
 * Get K-factor based on player's experience and rating
 * @param {number} totalGames - Total games played
 * @param {number} rating - Current rating
 * @returns {number} K-factor for rating calculation
 */
function getKFactor(totalGames, rating) {
  // Check games played FIRST - new players need volatility to find their true rating
  if (totalGames < 10) return K_FACTOR.NEW_PLAYER;
  if (totalGames < 30) return K_FACTOR.DEVELOPING;
  // Only apply master K-factor after player has enough games
  if (rating > 2000) return K_FACTOR.MASTER;
  return K_FACTOR.ESTABLISHED;
}

/**
 * Calculate new rating after a match
 * @param {number} playerRating - Current player rating
 * @param {number} opponentRating - Opponent's rating
 * @param {number} actualScore - 1 for win, 0.5 for draw, 0 for loss
 * @param {number} totalGames - Player's total games played
 * @returns {object} { newRating, change }
 */
function calculateNewRating(playerRating, opponentRating, actualScore, totalGames) {
  const expectedScore = getExpectedScore(playerRating, opponentRating);
  const kFactor = getKFactor(totalGames, playerRating);

  const change = Math.round(kFactor * (actualScore - expectedScore));
  // Apply floor (100) and ceiling (3500) to ratings
  const newRating = Math.min(3500, Math.max(100, playerRating + change));

  return {
    newRating,
    change,
    expectedScore: Math.round(expectedScore * 100) / 100,
    kFactor
  };
}

/**
 * Calculate rating changes for both players after a match
 * Uses shared K-factor (average) to ensure zero-sum rating changes
 * @param {object} winner - { rating, totalGames }
 * @param {object} loser - { rating, totalGames }
 * @returns {object} { winner: { newRating, change }, loser: { newRating, change } }
 */
function calculateMatchRatings(winner, loser) {
  // Use shared K-factor to ensure zero-sum (no rating inflation)
  const winnerK = getKFactor(winner.totalGames, winner.rating);
  const loserK = getKFactor(loser.totalGames, loser.rating);
  const sharedK = Math.round((winnerK + loserK) / 2);

  const expectedScore = getExpectedScore(winner.rating, loser.rating);
  const change = Math.round(sharedK * (1 - expectedScore));

  // Preserve zero-sum at the rating floor (100): the winner can only gain
  // as much rating as the loser is able to lose without dropping below 100.
  // If the loser is already at/under the floor, no rating is transferred.
  const loserHeadroom = Math.max(0, loser.rating - 100);
  const effectiveChange = Math.max(0, Math.min(change, loserHeadroom));

  // Apply ceiling (3500) to winner; loser is already floor-safe by construction.
  // Defensive floor on both sides in case inputs were already malformed.
  const winnerNewRating = Math.min(3500, Math.max(100, winner.rating + effectiveChange));
  const loserNewRating = Math.min(3500, Math.max(100, loser.rating - effectiveChange));

  return {
    winner: {
      newRating: winnerNewRating,
      change: winnerNewRating - winner.rating,
      expectedScore: Math.round(expectedScore * 100) / 100,
      kFactor: sharedK
    },
    loser: {
      newRating: loserNewRating,
      change: loserNewRating - loser.rating,
      expectedScore: Math.round((1 - expectedScore) * 100) / 100,
      kFactor: sharedK
    }
  };
}

/**
 * Calculate rating changes for a tie
 * Uses shared K-factor (average) to ensure zero-sum rating changes
 * @param {object} player1 - { rating, totalGames }
 * @param {object} player2 - { rating, totalGames }
 * @returns {object} { player1: { newRating, change }, player2: { newRating, change } }
 */
function calculateTieRatings(player1, player2) {
  // Use shared K-factor to ensure zero-sum
  const k1 = getKFactor(player1.totalGames, player1.rating);
  const k2 = getKFactor(player2.totalGames, player2.rating);
  const sharedK = Math.round((k1 + k2) / 2);

  const expectedScore1 = getExpectedScore(player1.rating, player2.rating);
  const expectedScore2 = 1 - expectedScore1;

  // In a tie, both players get 0.5
  const change1 = Math.round(sharedK * (0.5 - expectedScore1));
  const change2 = Math.round(sharedK * (0.5 - expectedScore2));

  // Preserve zero-sum at the rating floor (100). A tie transfers rating from
  // the higher-rated player to the lower-rated one; cap the magnitude of that
  // transfer so the loser-of-rating cannot fall below 100. We use the smaller
  // of |change1|, |change2| as the transfer magnitude (these are equal up to
  // a 1-point rounding difference) so the operation stays symmetric.
  const transferMagnitude = Math.min(Math.abs(change1), Math.abs(change2));
  // Determine which player is losing rating; cap by their headroom above 100.
  // If both changes are zero (or non-negative), nothing to cap.
  let effective1 = change1;
  let effective2 = change2;
  if (change1 < 0 && change2 > 0) {
    const headroom = Math.max(0, player1.rating - 100);
    const capped = Math.min(transferMagnitude, headroom);
    effective1 = -capped;
    effective2 = capped;
  } else if (change2 < 0 && change1 > 0) {
    const headroom = Math.max(0, player2.rating - 100);
    const capped = Math.min(transferMagnitude, headroom);
    effective2 = -capped;
    effective1 = capped;
  }

  // Defensive floor/ceiling, by construction the loser-of-rating is now safe.
  const newRating1 = Math.min(3500, Math.max(100, player1.rating + effective1));
  const newRating2 = Math.min(3500, Math.max(100, player2.rating + effective2));

  return {
    player1: {
      newRating: newRating1,
      change: newRating1 - player1.rating,
      expectedScore: Math.round(expectedScore1 * 100) / 100,
      kFactor: sharedK
    },
    player2: {
      newRating: newRating2,
      change: newRating2 - player2.rating,
      expectedScore: Math.round(expectedScore2 * 100) / 100,
      kFactor: sharedK
    }
  };
}

/**
 * Calculate rating changes for a partial credit win (timeout with different test progress)
 * Winner is determined by who passed more tests, ELO is scaled based on the difference
 *
 * @param {object} winner - { rating, totalGames, testsPassed }
 * @param {object} loser - { rating, totalGames, testsPassed }
 * @param {number} totalTests - Total number of test cases in the problem
 * @returns {object} { winner: { newRating, change }, loser: { newRating, change }, scaleFactor }
 */
function calculatePartialCreditRatings(winner, loser, totalTests) {
  // Calculate scale factor based on test difference
  // Formula: scaleFactor = (winnerTests - loserTests) / totalTests
  // This gives values from near 0 (1 test difference) to 1 (all tests vs none)
  const testDifference = winner.testsPassed - loser.testsPassed;
  const scaleFactor = totalTests > 0 ? testDifference / totalTests : 0;

  // Calculate base ELO change as if it were a normal win
  const winnerK = getKFactor(winner.totalGames, winner.rating);
  const loserK = getKFactor(loser.totalGames, loser.rating);
  const sharedK = Math.round((winnerK + loserK) / 2);

  const expectedScore = getExpectedScore(winner.rating, loser.rating);
  const baseChange = Math.round(sharedK * (1 - expectedScore));

  // Apply partial credit scaling: minimum 50% of base, up to 100% for maximum difference
  // Formula: actualChange = baseChange * (0.5 + 0.5 * scaleFactor)
  const partialCreditMultiplier = 0.5 + (0.5 * scaleFactor);
  const scaledChange = Math.round(baseChange * partialCreditMultiplier);

  // Ensure minimum change of 1 point for winner (if there was any difference)
  const finalChange = Math.max(1, scaledChange);

  // Preserve zero-sum at the rating floor (100): cap the transferred amount
  // to whatever rating the loser has above the floor. If the loser is already
  // at/under 100, no rating is transferred.
  const loserHeadroom = Math.max(0, loser.rating - 100);
  const effectiveChange = Math.max(0, Math.min(finalChange, loserHeadroom));

  // Apply ceiling (3500); loser is floor-safe by construction. Defensive
  // floor on both sides in case inputs were already malformed.
  const winnerNewRating = Math.min(3500, Math.max(100, winner.rating + effectiveChange));
  const loserNewRating = Math.min(3500, Math.max(100, loser.rating - effectiveChange));

  return {
    winner: {
      newRating: winnerNewRating,
      change: winnerNewRating - winner.rating,
      expectedScore: Math.round(expectedScore * 100) / 100,
      kFactor: sharedK
    },
    loser: {
      newRating: loserNewRating,
      change: loserNewRating - loser.rating,
      expectedScore: Math.round((1 - expectedScore) * 100) / 100,
      kFactor: sharedK
    },
    scaleFactor: Math.round(partialCreditMultiplier * 100) / 100,
    testDifference
  };
}

/**
 * Get rank tier based on rating
 * @param {number} rating - Player's rating
 * @returns {object} { name, color, icon, min, max }
 */
function getRankTier(rating) {
  for (const [key, tier] of Object.entries(RANK_TIERS)) {
    if (rating >= tier.min && rating <= tier.max) {
      return { ...tier, key };
    }
  }
  return { ...RANK_TIERS.BRONZE, key: 'BRONZE' };
}

/**
 * Get rank division within a tier (1-4, with 1 being highest)
 * @param {number} rating - Player's rating
 * @returns {object} { tier, division, progress }
 */
function getRankDivision(rating) {
  const tier = getRankTier(rating);
  const tierRange = tier.max - tier.min;

  if (tierRange === Infinity) {
    // Grandmaster - no divisions, just show rating
    return {
      tier,
      division: null,
      progress: 100,
      display: `${tier.name}`
    };
  }

  const positionInTier = rating - tier.min;
  const divisionSize = tierRange / 4;

  // Division 4 is lowest (0-25%), Division 1 is highest (75-100%)
  const divisionIndex = Math.min(3, Math.floor(positionInTier / divisionSize));
  const division = 4 - divisionIndex;

  // Progress within current division
  const divisionStart = divisionIndex * divisionSize;
  const progressInDivision = ((positionInTier - divisionStart) / divisionSize) * 100;

  return {
    tier,
    division,
    progress: Math.round(progressInDivision),
    display: `${tier.name} ${division}`
  };
}

/**
 * Check if two players are within matchmaking range
 * @param {number} rating1 - First player's rating
 * @param {number} rating2 - Second player's rating
 * @param {number} waitTimeMs - How long the first player has been waiting
 * @returns {boolean} Whether the players can be matched
 */
function isWithinMatchmakingRange(rating1, rating2, waitTimeMs = 0) {
  const ratingDiff = Math.abs(rating1 - rating2);

  // Calculate expanded range based on wait time
  const expansions = Math.floor(waitTimeMs / MATCHMAKING.RANGE_INCREMENT_INTERVAL);
  const expandedRange = Math.min(
    MATCHMAKING.MAX_RANGE,
    MATCHMAKING.INITIAL_RANGE + (expansions * MATCHMAKING.RANGE_INCREMENT)
  );

  return ratingDiff <= expandedRange;
}

/**
 * Get the current matchmaking range for a player based on wait time
 * @param {number} waitTimeMs - How long the player has been waiting
 * @returns {number} Current acceptable rating difference
 */
function getMatchmakingRange(waitTimeMs) {
  const expansions = Math.floor(waitTimeMs / MATCHMAKING.RANGE_INCREMENT_INTERVAL);
  return Math.min(
    MATCHMAKING.MAX_RANGE,
    MATCHMAKING.INITIAL_RANGE + (expansions * MATCHMAKING.RANGE_INCREMENT)
  );
}

/**
 * Find the best match from a list of candidates based on rating
 * @param {number} playerRating - The player looking for a match
 * @param {number} playerWaitTime - How long the player has been waiting
 * @param {Array} candidates - Array of { playerId, rating, waitTime }
 * @returns {object|null} Best match candidate or null
 */
function findBestRatingMatch(playerRating, playerWaitTime, candidates) {
  const currentRange = getMatchmakingRange(playerWaitTime);

  // Filter candidates within range
  const validCandidates = candidates.filter(c => {
    const ratingDiff = Math.abs(playerRating - c.rating);
    const candidateRange = getMatchmakingRange(c.waitTime);
    // Both players must accept the rating difference
    return ratingDiff <= currentRange && ratingDiff <= candidateRange;
  });

  if (validCandidates.length === 0) return null;

  // Sort by closest rating, then by longest wait time
  validCandidates.sort((a, b) => {
    const diffA = Math.abs(playerRating - a.rating);
    const diffB = Math.abs(playerRating - b.rating);

    if (diffA !== diffB) return diffA - diffB; // Prefer closer rating
    return b.waitTime - a.waitTime; // Then prefer longer waiting
  });

  return validCandidates[0];
}

module.exports = {
  // Constants
  K_FACTOR,
  RANK_TIERS,
  MATCHMAKING,

  // Core ELO functions
  getExpectedScore,
  getKFactor,
  calculateNewRating,
  calculateMatchRatings,
  calculateTieRatings,
  calculatePartialCreditRatings,

  // Rank functions
  getRankTier,
  getRankDivision,

  // Matchmaking functions
  isWithinMatchmakingRange,
  getMatchmakingRange,
  findBestRatingMatch
};
