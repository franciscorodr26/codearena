const crypto = require('crypto');

// Challenge templates pool
const DAILY_CHALLENGE_TEMPLATES = [
  {
    title: "Win Streak",
    description: "Win 3 agent battles in a row",
    requirement_type: "streak",
    requirement_value: { count: 3 },
    reward_type: "elo_bonus",
    reward_value: { amount: 25, message: "+25 ELO Bonus" }
  },
  {
    title: "Speed Demon",
    description: "Win a battle in under 3 minutes",
    requirement_type: "speed",
    requirement_value: { seconds: 180 },
    reward_type: "elo_bonus",
    reward_value: { amount: 20, message: "+20 ELO Bonus" }
  },
  {
    title: "Triple Threat",
    description: "Win 3 agent battles today",
    requirement_type: "wins",
    requirement_value: { count: 3 },
    reward_type: "elo_bonus",
    reward_value: { amount: 15, message: "+15 ELO Bonus" }
  },
  {
    title: "Haiku Hunter",
    description: "Win 2 battles against Claude Haiku",
    requirement_type: "model",
    requirement_value: { count: 2, model: "haiku" },
    reward_type: "elo_bonus",
    reward_value: { amount: 15, message: "+15 ELO Bonus" }
  },
  {
    title: "Sonnet Slayer",
    description: "Defeat Claude Sonnet in battle",
    requirement_type: "model",
    requirement_value: { count: 1, model: "sonnet" },
    reward_type: "elo_bonus",
    reward_value: { amount: 30, message: "+30 ELO Bonus" }
  },
  {
    title: "Python Pro",
    description: "Win 2 battles using Python",
    requirement_type: "language",
    requirement_value: { count: 2, language: "python" },
    reward_type: "elo_bonus",
    reward_value: { amount: 15, message: "+15 ELO Bonus" }
  },
  {
    title: "JavaScript Jedi",
    description: "Win 2 battles using JavaScript",
    requirement_type: "language",
    requirement_value: { count: 2, language: "javascript" },
    reward_type: "elo_bonus",
    reward_value: { amount: 15, message: "+15 ELO Bonus" }
  },
  {
    title: "Rust Ranger",
    description: "Win a battle using Rust",
    requirement_type: "language",
    requirement_value: { count: 1, language: "rust" },
    reward_type: "elo_bonus",
    reward_value: { amount: 25, message: "+25 ELO Bonus" }
  },
  {
    title: "Quick Victory",
    description: "Win a battle in under 5 minutes",
    requirement_type: "speed",
    requirement_value: { seconds: 300 },
    reward_type: "elo_bonus",
    reward_value: { amount: 15, message: "+15 ELO Bonus" }
  },
  {
    title: "Battle Veteran",
    description: "Win 5 agent battles today",
    requirement_type: "wins",
    requirement_value: { count: 5 },
    reward_type: "elo_bonus",
    reward_value: { amount: 30, message: "+30 ELO Bonus" }
  }
];

const WEEKLY_CHALLENGE_TEMPLATES = [
  {
    title: "Weekly Warrior",
    description: "Win 15 agent battles this week",
    requirement_type: "wins",
    requirement_value: { count: 15 },
    reward_type: "elo_bonus",
    reward_value: { amount: 100, message: "+100 ELO Bonus" }
  },
  {
    title: "Unstoppable Force",
    description: "Achieve a 5-win streak this week",
    requirement_type: "streak",
    requirement_value: { count: 5 },
    reward_type: "elo_bonus",
    reward_value: { amount: 75, message: "+75 ELO Bonus" }
  },
  {
    title: "Sonnet Dominator",
    description: "Defeat Claude Sonnet 5 times this week",
    requirement_type: "model",
    requirement_value: { count: 5, model: "sonnet" },
    reward_type: "elo_bonus",
    reward_value: { amount: 150, message: "+150 ELO Bonus" }
  },
  {
    title: "Opus Overlord",
    description: "Defeat Claude Opus 3 times this week",
    requirement_type: "model",
    requirement_value: { count: 3, model: "opus" },
    reward_type: "elo_bonus",
    reward_value: { amount: 200, message: "+200 ELO Bonus" }
  },
  {
    title: "Polyglot Master",
    description: "Win battles in 3 different languages this week",
    requirement_type: "languages",
    requirement_value: { count: 3 },
    reward_type: "elo_bonus",
    reward_value: { amount: 80, message: "+80 ELO Bonus" }
  },
  {
    title: "Speed Champion",
    description: "Win 3 battles in under 3 minutes each this week",
    requirement_type: "speed_multiple",
    requirement_value: { count: 3, seconds: 180 },
    reward_type: "elo_bonus",
    reward_value: { amount: 90, message: "+90 ELO Bonus" }
  },
  {
    title: "Consistency King",
    description: "Win at least 1 battle every day this week",
    requirement_type: "daily_wins",
    requirement_value: { days: 7 },
    reward_type: "elo_bonus",
    reward_value: { amount: 120, message: "+120 ELO Bonus" }
  },
  {
    title: "AI Challenger",
    description: "Win 20 agent battles this week",
    requirement_type: "wins",
    requirement_value: { count: 20 },
    reward_type: "elo_bonus",
    reward_value: { amount: 150, message: "+150 ELO Bonus" }
  },
  {
    title: "C++ Conqueror",
    description: "Win 5 battles using C++ this week",
    requirement_type: "language",
    requirement_value: { count: 5, language: "cpp" },
    reward_type: "elo_bonus",
    reward_value: { amount: 100, message: "+100 ELO Bonus" }
  },
  {
    title: "Go Guru",
    description: "Win 5 battles using Go this week",
    requirement_type: "language",
    requirement_value: { count: 5, language: "go" },
    reward_type: "elo_bonus",
    reward_value: { amount: 100, message: "+100 ELO Bonus" }
  }
];

/**
 * Generate a random challenge from templates
 */
function selectRandomChallenge(templates) {
  const randomIndex = Math.floor(Math.random() * templates.length);
  return templates[randomIndex];
}

/**
 * Create a daily challenge
 */
function generateDailyChallenge(date = new Date()) {
  const template = selectRandomChallenge(DAILY_CHALLENGE_TEMPLATES);
  const starts_at = new Date(date);
  starts_at.setHours(0, 0, 0, 0);

  const ends_at = new Date(starts_at);
  ends_at.setHours(23, 59, 59, 999);

  const id = `daily-${starts_at.toISOString().split('T')[0]}-${crypto.randomBytes(4).toString('hex')}`;

  return {
    id,
    type: 'daily',
    title: template.title,
    description: template.description,
    requirement_type: template.requirement_type,
    requirement_value: template.requirement_value,
    reward_type: template.reward_type,
    reward_value: template.reward_value,
    starts_at: starts_at.toISOString(),
    ends_at: ends_at.toISOString()
  };
}

/**
 * Create a weekly challenge
 */
function generateWeeklyChallenge(date = new Date()) {
  const template = selectRandomChallenge(WEEKLY_CHALLENGE_TEMPLATES);

  // Get Monday of current week
  const starts_at = new Date(date);
  const day = starts_at.getDay();
  const diff = starts_at.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
  starts_at.setDate(diff);
  starts_at.setHours(0, 0, 0, 0);

  // Get Sunday end of week
  const ends_at = new Date(starts_at);
  ends_at.setDate(starts_at.getDate() + 6);
  ends_at.setHours(23, 59, 59, 999);

  const id = `weekly-${starts_at.toISOString().split('T')[0]}-${crypto.randomBytes(4).toString('hex')}`;

  return {
    id,
    type: 'weekly',
    title: template.title,
    description: template.description,
    requirement_type: template.requirement_type,
    requirement_value: template.requirement_value,
    reward_type: template.reward_type,
    reward_value: template.reward_value,
    starts_at: starts_at.toISOString(),
    ends_at: ends_at.toISOString()
  };
}

/**
 * Check if a battle matches challenge requirements
 */
function checkBattleMatchesRequirement(battle, requirementType, requirementValue) {
  switch (requirementType) {
    case 'wins':
      return battle.winner === 'player';

    case 'streak':
      // Streak is tracked separately, just verify it's a win
      return battle.winner === 'player';

    case 'model':
      // Check if won against specific model
      return battle.winner === 'player' &&
             battle.aiModel.toLowerCase().includes(requirementValue.model.toLowerCase());

    case 'language':
      // Check if won with specific language
      return battle.winner === 'player' &&
             battle.language.toLowerCase() === requirementValue.language.toLowerCase();

    case 'speed':
      // Check if won within time limit
      return battle.winner === 'player' &&
             battle.duration <= requirementValue.seconds;

    case 'speed_multiple':
      // Check if won within time limit (for multiple wins tracking)
      return battle.winner === 'player' &&
             battle.duration <= requirementValue.seconds;

    case 'languages':
      // Track for polyglot challenge (tracked separately)
      return battle.winner === 'player';

    case 'daily_wins':
      // Track for consistency challenge (tracked separately)
      return battle.winner === 'player';

    default:
      return false;
  }
}

/**
 * Calculate progress for a challenge based on battle result
 */
function calculateProgress(currentProgress, challenge, battle, userStats = {}) {
  const { requirement_type, requirement_value } = challenge;

  switch (requirement_type) {
    case 'wins':
      // Simple win counter
      return currentProgress + 1;

    case 'streak':
      // Reset on loss, increment on win
      if (battle.winner !== 'player') {
        return 0;
      }
      return currentProgress + 1;

    case 'model':
    case 'language':
    case 'speed':
      // Increment if matches
      if (checkBattleMatchesRequirement(battle, requirement_type, requirement_value)) {
        return currentProgress + 1;
      }
      return currentProgress;

    case 'speed_multiple':
      // Count fast wins
      if (checkBattleMatchesRequirement(battle, requirement_type, requirement_value)) {
        return currentProgress + 1;
      }
      return currentProgress;

    case 'languages':
      // Track unique languages (stored as JSON array in progress metadata)
      if (battle.winner === 'player') {
        const languages = userStats.languages || [];
        if (!languages.includes(battle.language)) {
          languages.push(battle.language);
          return languages.length;
        }
      }
      return currentProgress;

    case 'daily_wins':
      // Track days with wins (stored as JSON array of dates in progress metadata)
      if (battle.winner === 'player') {
        const dates = userStats.dates || [];
        const today = new Date().toISOString().split('T')[0];
        if (!dates.includes(today)) {
          dates.push(today);
          return dates.length;
        }
      }
      return currentProgress;

    default:
      return currentProgress;
  }
}

/**
 * Check if challenge is complete
 */
function isChallengeComplete(progress, challenge) {
  const { requirement_type, requirement_value } = challenge;

  switch (requirement_type) {
    case 'wins':
    case 'streak':
    case 'model':
    case 'language':
    case 'speed':
    case 'speed_multiple':
      return progress >= requirement_value.count;

    case 'languages':
      return progress >= requirement_value.count;

    case 'daily_wins':
      return progress >= requirement_value.days;

    default:
      return false;
  }
}

module.exports = {
  DAILY_CHALLENGE_TEMPLATES,
  WEEKLY_CHALLENGE_TEMPLATES,
  generateDailyChallenge,
  generateWeeklyChallenge,
  checkBattleMatchesRequirement,
  calculateProgress,
  isChallengeComplete
};
