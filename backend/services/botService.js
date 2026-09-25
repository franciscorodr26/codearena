const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Bot names for variety
const BOT_NAMES = [
  'CodeBot', 'ByteBuddy', 'SyntaxSensei', 'AlgoAce', 'LoopLord',
  'RecursoRex', 'DataDroid', 'BitBrain', 'LogicLlama', 'StackSurfer',
  'HashHero', 'TreeTamer', 'GraphGuru', 'HeapHelper', 'QueueQueen',
  'ArrayAce', 'StringSlayer', 'MemoMaster', 'DPDragon', 'GreedyGhost'
];

// Legacy difficulty tiers based on player rating (used for auto-matching)
const DIFFICULTY_TIERS = {
  easy: {
    minRating: 0,
    maxRating: 1199,
    solveTimeRange: [120, 180], // 2-3 minutes
    description: 'Beginner'
  },
  medium: {
    minRating: 1200,
    maxRating: 1599,
    solveTimeRange: [60, 120], // 1-2 minutes
    description: 'Intermediate'
  },
  hard: {
    minRating: 1600,
    maxRating: 9999,
    solveTimeRange: [30, 60], // 30s-1 minute
    description: 'Advanced'
  }
};

// User-selectable bot difficulty tiers
// Note: giveUpRate + mistakeRate + winRate should sum to < 1.0 to allow for "slow loss" outcome
const SELECTABLE_BOT_TIERS = {
  easy: {
    displayName: 'Easy Bot',
    description: 'Great for learning - makes mistakes and solves slowly',
    rating: 800,
    winRate: 0.50, // Bot wins 50% of the time (reduced to allow slow loss)
    solveTimeRange: {
      Easy: [180, 300],    // 3-5 min for easy problems
      Medium: [240, 420],  // 4-7 min for medium
      Hard: [300, 540]     // 5-9 min for hard
    },
    mistakeRate: 0.40, // 40% chance of making mistakes (absorbed old giveUpRate)
    giveUpRate: 0.00   // Bot never gives up
    // Remaining 10% = slow loss (bot takes too long)
  },
  medium: {
    displayName: 'Medium Bot',
    description: 'Balanced challenge - occasionally makes mistakes',
    rating: 1200,
    winRate: 0.78, // Bot wins 78% of the time (reduced to allow slow loss)
    solveTimeRange: {
      Easy: [60, 120],    // 1-2 min
      Medium: [90, 180],  // 1.5-3 min
      Hard: [150, 300]    // 2.5-5 min
    },
    mistakeRate: 0.15, // Absorbed old giveUpRate into mistakes
    giveUpRate: 0.00
    // Remaining 7% = slow loss
  },
  hard: {
    displayName: 'Hard Bot',
    description: 'Tough opponent - fast and accurate',
    rating: 1600,
    winRate: 0.90, // Bot wins 90% of the time (reduced to allow slow loss)
    solveTimeRange: {
      Easy: [30, 60],     // 30s-1 min
      Medium: [45, 90],   // 45s-1.5 min
      Hard: [60, 150]     // 1-2.5 min
    },
    mistakeRate: 0.05, // Absorbed old giveUpRate into mistakes
    giveUpRate: 0.00
    // Remaining 5% = slow loss
  },
  grandmaster: {
    displayName: 'Grandmaster Bot',
    description: 'Elite AI - nearly unbeatable speed',
    rating: 2200,
    winRate: 0.97, // Bot wins 97% of the time (reduced to allow slow loss)
    solveTimeRange: {
      Easy: [15, 30],     // 15-30s
      Medium: [25, 50],   // 25-50s
      Hard: [40, 80]      // 40s-1.3 min
    },
    mistakeRate: 0.01,
    giveUpRate: 0.00
    // Remaining 2% = slow loss
  }
};

/**
 * Get the difficulty tier based on player rating (for auto-matching)
 * @param {number} playerRating - The player's ELO rating
 * @returns {string} - Difficulty tier name (easy, medium, hard)
 */
function getBotDifficulty(playerRating) {
  if (playerRating >= DIFFICULTY_TIERS.hard.minRating) {
    return 'hard';
  } else if (playerRating >= DIFFICULTY_TIERS.medium.minRating) {
    return 'medium';
  }
  return 'easy';
}

/**
 * Get selectable bot tier info
 * @param {string} tier - Tier name (easy, medium, hard, grandmaster)
 * @returns {object|null} - Tier configuration or null
 */
function getSelectableTier(tier) {
  return SELECTABLE_BOT_TIERS[tier] || null;
}

/**
 * Simulate the outcome of a bot battle based on difficulty
 * Returns what will happen: 'win' (bot wins), 'lose' (bot loses), or 'giveup' (bot gives up)
 * @param {string} difficulty - Bot difficulty tier
 * @returns {object} - { outcome: 'win'|'lose'|'giveup', reason: string }
 *
 * Probability distribution:
 * - [0, giveUpRate): bot gives up
 * - [giveUpRate, giveUpRate + mistakeRate): bot loses (incorrect solution)
 * - [giveUpRate + mistakeRate, giveUpRate + mistakeRate + winRate): bot wins
 * - [giveUpRate + mistakeRate + winRate, 1): bot loses (too slow)
 */
function simulateBotOutcome(difficulty) {
  const tier = SELECTABLE_BOT_TIERS[difficulty] || SELECTABLE_BOT_TIERS.medium;
  const roll = Math.random();

  // Calculate cumulative probability thresholds
  const giveUpThreshold = tier.giveUpRate;
  const mistakeThreshold = giveUpThreshold + tier.mistakeRate;
  const winThreshold = mistakeThreshold + tier.winRate;

  // Check if bot gives up first
  if (roll < giveUpThreshold) {
    return {
      outcome: 'giveup',
      reason: 'Bot encountered an edge case it couldn\'t handle'
    };
  }

  // Check if bot makes a critical mistake (leads to loss)
  if (roll < mistakeThreshold) {
    return {
      outcome: 'lose',
      reason: 'Bot submitted incorrect solution'
    };
  }

  // Check if bot wins
  if (roll < winThreshold) {
    return { outcome: 'win', reason: null };
  }

  // Bot loses by being slower
  return {
    outcome: 'lose',
    reason: 'Bot was too slow to solve'
  };
}

/**
 * Get a random bot name
 * @returns {string} - A random bot name
 */
function getRandomBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

/**
 * Calculate the bot's solve time based on difficulty and problem difficulty
 * @param {string} botDifficulty - Bot difficulty tier (easy, medium, hard, grandmaster)
 * @param {string} problemDifficulty - Problem difficulty (Easy, Medium, Hard)
 * @param {boolean} useSelectableTiers - Whether to use the new selectable tiers
 * @returns {number} - Time in seconds for the bot to solve
 */
function getBotSolveTime(botDifficulty, problemDifficulty, useSelectableTiers = false) {
  // Use new selectable tiers if requested
  if (useSelectableTiers && SELECTABLE_BOT_TIERS[botDifficulty]) {
    const tier = SELECTABLE_BOT_TIERS[botDifficulty];
    const normalizedDifficulty = problemDifficulty || 'Medium';
    const range = tier.solveTimeRange[normalizedDifficulty] || tier.solveTimeRange.Medium;
    const [minTime, maxTime] = range;

    // Add some randomness (±15%)
    const baseTime = Math.random() * (maxTime - minTime) + minTime;
    const variance = baseTime * 0.15 * (Math.random() * 2 - 1);
    return Math.round(Math.max(10, baseTime + variance));
  }

  // Legacy behavior for auto-matched bots
  const tier = DIFFICULTY_TIERS[botDifficulty];
  if (!tier) {
    return 90; // Default fallback
  }

  const [minTime, maxTime] = tier.solveTimeRange;

  // Adjust based on problem difficulty
  let multiplier = 1;
  if (problemDifficulty === 'Hard') {
    multiplier = 1.5;
  } else if (problemDifficulty === 'Easy') {
    multiplier = 0.7;
  }

  // Random time within range, adjusted by problem difficulty
  const baseTime = Math.random() * (maxTime - minTime) + minTime;
  return Math.round(baseTime * multiplier);
}

/**
 * Create a bot player for a battle
 * @param {number} playerRating - The human player's rating (used for auto-difficulty)
 * @param {string} language - The programming language for the battle
 * @param {string} [selectedDifficulty] - Optional user-selected difficulty tier
 * @returns {object} - Bot player object
 */
function createBotPlayer(playerRating, language, selectedDifficulty = null) {
  // If user selected a specific difficulty, use the new selectable tiers
  if (selectedDifficulty && SELECTABLE_BOT_TIERS[selectedDifficulty]) {
    const tier = SELECTABLE_BOT_TIERS[selectedDifficulty];
    return {
      id: `bot-${uuidv4()}`,
      name: getRandomBotName(),
      difficulty: selectedDifficulty,
      botDifficulty: selectedDifficulty, // For compatibility
      difficultyDescription: tier.displayName,
      language,
      rating: tier.rating,
      isBot: true,
      isSelectableDifficulty: true // Flag to use new behavior
    };
  }

  // Legacy auto-difficulty based on player rating
  const difficulty = getBotDifficulty(playerRating);
  const tier = DIFFICULTY_TIERS[difficulty];

  return {
    id: `bot-${uuidv4()}`,
    name: getRandomBotName(),
    difficulty,
    botDifficulty: difficulty, // For compatibility
    difficultyDescription: tier.description,
    language,
    rating: Math.floor((tier.minRating + tier.maxRating) / 2), // Middle of range for display
    isBot: true,
    isSelectableDifficulty: false
  };
}

const SOLUTION_EXT = { javascript: 'js', typescript: 'js', python: 'py' };

function solutionDirs() {
  const dirs = [path.join(__dirname, '..', 'arena', 'solutions')];
  if (process.env.CODEARENA_PRIVATE_PROBLEMS_DIR) {
    dirs.push(path.join(process.env.CODEARENA_PRIVATE_PROBLEMS_DIR, 'solutions'));
  }
  return dirs;
}

/**
 * Reference solution the bot submits for a problem, or null when none exists
 * for that language. Solutions live next to the problems (arena/solutions and
 * the optional private set); TypeScript bots use the JavaScript reference.
 */
function getBotSolution(problemId, language) {
  const ext = SOLUTION_EXT[language];
  if (!ext || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(problemId))) return null;
  for (const dir of solutionDirs()) {
    try {
      return fs.readFileSync(path.join(dir, `${problemId}.${ext}`), 'utf8');
    } catch {
      // try the next directory
    }
  }
  return null;
}

module.exports = {
  createBotPlayer,
  getBotDifficulty,
  getBotSolveTime,
  getBotSolution,
  getRandomBotName,
  getSelectableTier,
  simulateBotOutcome,
  BOT_NAMES,
  DIFFICULTY_TIERS,
  SELECTABLE_BOT_TIERS
};
