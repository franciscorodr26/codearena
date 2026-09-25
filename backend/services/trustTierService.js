/**
 * Trust Tier Service v2
 *
 * CORE PRINCIPLE: Detection is IDENTICAL for everyone. Trust affects CONSEQUENCES only.
 *
 * This service manages:
 * - Tier classification (based on score + sustained behavior)
 * - Consequence determination (what happens when flagged)
 * - Trust scoring (gain, loss, decay)
 * - Behavior anomaly detection (z-score based personal comparison)
 *
 * Tiers:
 * - Trusted (85-100): Human review before any action
 * - Standard (50-84): Normal progressive discipline
 * - Probation (25-49): Accelerated discipline
 * - Restricted (0-24): Immediate action on any flag
 */

// ==============================================
// TIER DEFINITIONS
// ==============================================

const TRUST_TIERS = {
  TRUSTED: {
    name: 'trusted',
    minScore: 85,
    consequenceMultiplier: 0.5, // Halves consequence severity
    description: 'Human review before any action'
  },
  STANDARD: {
    name: 'standard',
    minScore: 50,
    consequenceMultiplier: 1.0, // Normal discipline
    description: 'Normal progressive discipline'
  },
  PROBATION: {
    name: 'probation',
    minScore: 25,
    consequenceMultiplier: 1.5, // Accelerated discipline
    description: 'Enhanced monitoring'
  },
  RESTRICTED: {
    name: 'restricted',
    minScore: 0,
    consequenceMultiplier: 2.0, // Immediate action
    description: 'Limited access'
  }
};

// Trust gain constants
const TRUST_GAIN = {
  cleanBattle: {
    base: 0.5,
    winBonus: 0.25,
    difficultyBonus: { easy: 0, medium: 0.1, hard: 0.2 }
  },
  milestones: {
    cleanStreak10: 3,
    cleanStreak25: 5,
    cleanStreak50: 10,
    accountAge90Days: 2,
    accountAge180Days: 3
  },
  recovery: {
    first10CleanAfterViolation: 2,
    adminClearedFalsePositive: 5
  },
  dailyCap: 3
};

// Trust loss constants
const TRUST_LOSS = {
  violation: {
    warning: -3,
    serious: -10,
    critical: -20
  },
  adminConfirmed: {
    cheating: -40,
    multipleAccounts: -30,
    harassment: -15
  },
  discipline: {
    suspension24h: -15,
    suspension7d: -25,
    permanentBan: -100
  }
};

// Trust decay constants
const TRUST_DECAY = {
  inactivityThresholdDays: 30,
  decayPerWeek: 1,
  floorClean: 40,
  floorWithViolations: 25
};

// ==============================================
// TIER FUNCTIONS
// ==============================================

/**
 * Get trust tier object from score
 */
function getTierFromScore(score) {
  if (score >= 85) return TRUST_TIERS.TRUSTED;
  if (score >= 50) return TRUST_TIERS.STANDARD;
  if (score >= 25) return TRUST_TIERS.PROBATION;
  return TRUST_TIERS.RESTRICTED;
}

/**
 * Get tier object by name
 */
function getTierByName(tierName) {
  const tier = Object.values(TRUST_TIERS).find(t => t.name === tierName);
  return tier || TRUST_TIERS.STANDARD;
}

// ==============================================
// CONSEQUENCE DETERMINATION (Core v2 Logic)
// ==============================================

/**
 * Determine consequences based on tier and anomaly detection.
 * This is the CORE v2 function - detection is the same for everyone,
 * but consequences vary by tier.
 *
 * @param {object} analysis - Raw anti-cheat analysis result
 * @param {object} trustInfo - User's trust tier info
 * @param {object} behaviorAnomaly - Behavior anomaly detection result
 * @returns {object} Consequences to apply
 */
function determineConsequences(analysis, trustInfo, behaviorAnomaly) {
  const tier = getTierByName(trustInfo?.trust_tier || 'standard');
  const multiplier = tier.consequenceMultiplier;

  // If behavior matches personal pattern, reduce confidence in flag
  const anomalyReduction = behaviorAnomaly?.hasBaseline && behaviorAnomaly.score < 0.2 ? 0.3 : 0;

  // Effective suspicion for consequence determination (NOT detection)
  const effectiveSuspicion = analysis.totalSuspicion * multiplier * (1 - anomalyReduction);

  let action = 'none';
  let requiresHumanReview = false;
  let skipAutoDiscipline = false;
  const reasons = [];

  // Tier-specific consequence logic
  if (tier.name === 'trusted') {
    // Trusted users always get human review first
    requiresHumanReview = true;
    skipAutoDiscipline = true;
    if (effectiveSuspicion >= 0.8) {
      action = 'flag_for_review';
      reasons.push('Trusted user - flagging for human review before any action');
    } else if (effectiveSuspicion >= 0.4) {
      action = 'silent_note';
      reasons.push('Trusted user - logging but no action');
    }
  } else if (tier.name === 'restricted') {
    // Restricted users get immediate action
    if (effectiveSuspicion >= 0.4) {
      action = 'auto_discipline';
      reasons.push('Restricted tier - immediate discipline on flag');
    } else {
      action = 'flag_for_review';
      reasons.push('Restricted tier - flagging for review');
    }
  } else if (tier.name === 'probation') {
    // Probation users have accelerated discipline
    if (effectiveSuspicion >= 1.0) {
      action = 'auto_discipline';
      reasons.push('Probation tier - accelerated discipline');
    } else if (effectiveSuspicion >= 0.5) {
      action = 'flag_for_review';
      reasons.push('Probation tier - flagging for review');
    } else {
      action = 'warning';
    }
  } else {
    // Standard progressive discipline
    if (effectiveSuspicion >= 1.5) {
      action = 'auto_discipline';
      reasons.push('Standard discipline - auto-flag threshold met');
    } else if (effectiveSuspicion >= 0.8) {
      action = 'flag_for_review';
      reasons.push('Standard discipline - manual review needed');
    } else if (effectiveSuspicion >= 0.4) {
      action = 'warning';
      reasons.push('Standard discipline - warning issued');
    }
  }

  // Add anomaly context
  if (behaviorAnomaly?.hasBaseline) {
    if (behaviorAnomaly.score < 0.2) {
      reasons.push('Behavior matches personal pattern - may be false positive');
    } else if (behaviorAnomaly.score > 0.5) {
      reasons.push(`Behavior deviates from pattern (anomaly: ${(behaviorAnomaly.score * 100).toFixed(0)}%)`);
      behaviorAnomaly.factors?.forEach(f => reasons.push(`- ${f.message}`));
    }
  } else {
    reasons.push('Insufficient history for behavioral comparison');
  }

  return {
    action,
    effectiveSuspicion,
    requiresHumanReview,
    skipAutoDiscipline,
    tierName: tier.name,
    tierMultiplier: multiplier,
    behaviorAnomalyScore: behaviorAnomaly?.score || 0,
    behaviorAnomalyAdjustment: anomalyReduction,
    reasoning: reasons
  };
}

// ==============================================
// TRUST SCORING
// ==============================================

/**
 * Calculate trust gain for a clean battle with daily cap
 *
 * @param {string} battleResult - 'win', 'loss', 'tie', 'forfeit'
 * @param {string} difficulty - 'easy', 'medium', 'hard'
 * @param {object} context - { dailyGainedSoFar, accountAgeDays }
 * @returns {object} { gain, cappedGain, hitDailyCap, breakdown }
 */
function calculateTrustGain(battleResult, difficulty, context = {}) {
  const { dailyGainedSoFar = 0 } = context;
  const breakdown = [];

  // Base gain
  let gain = TRUST_GAIN.cleanBattle.base;
  breakdown.push(`Base: +${TRUST_GAIN.cleanBattle.base}`);

  // Win bonus
  if (battleResult === 'win') {
    gain += TRUST_GAIN.cleanBattle.winBonus;
    breakdown.push(`Win bonus: +${TRUST_GAIN.cleanBattle.winBonus}`);
  }

  // Difficulty bonus
  const diffBonus = TRUST_GAIN.cleanBattle.difficultyBonus[difficulty] || 0;
  if (diffBonus > 0) {
    gain += diffBonus;
    breakdown.push(`${difficulty} difficulty: +${diffBonus}`);
  }

  // Cap per battle
  const maxPerBattle = 0.95;
  gain = Math.min(gain, maxPerBattle);

  // Apply daily cap
  const remainingDailyCap = Math.max(0, TRUST_GAIN.dailyCap - dailyGainedSoFar);
  const cappedGain = Math.min(gain, remainingDailyCap);
  const hitDailyCap = cappedGain < gain;

  if (hitDailyCap) {
    breakdown.push(`Daily cap applied: ${cappedGain.toFixed(2)} (max ${TRUST_GAIN.dailyCap}/day)`);
  }

  return {
    gain,
    cappedGain,
    hitDailyCap,
    breakdown
  };
}

/**
 * Calculate trust loss for violations
 *
 * @param {string} severity - 'warning', 'serious', 'critical'
 * @param {string} source - 'violation', 'admin_confirmed', 'discipline'
 * @returns {number} Trust points to subtract (negative number)
 */
function calculateTrustLoss(severity, source = 'violation') {
  if (source === 'admin_confirmed') {
    return TRUST_LOSS.adminConfirmed[severity] || -10;
  }
  if (source === 'discipline') {
    return TRUST_LOSS.discipline[severity] || -15;
  }
  return TRUST_LOSS.violation[severity] || -5;
}

/**
 * Calculate trust decay due to inactivity
 *
 * @param {string} lastActiveDate - ISO date string
 * @param {boolean} hasViolations - Whether user has violation history
 * @param {number} currentScore - Current trust score
 * @returns {object} { shouldDecay, decayAmount, newScore, reason }
 */
function calculateTrustDecay(lastActiveDate, hasViolations, currentScore) {
  if (!lastActiveDate) {
    return { shouldDecay: false, decayAmount: 0, newScore: currentScore, reason: 'No activity date' };
  }

  const lastActive = new Date(lastActiveDate);
  const now = new Date();
  const daysSinceActive = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24));

  if (daysSinceActive < TRUST_DECAY.inactivityThresholdDays) {
    return {
      shouldDecay: false,
      decayAmount: 0,
      newScore: currentScore,
      reason: `Active within ${TRUST_DECAY.inactivityThresholdDays} days`
    };
  }

  // Calculate weeks of inactivity beyond threshold
  const inactiveWeeks = Math.floor((daysSinceActive - TRUST_DECAY.inactivityThresholdDays) / 7);
  const decayAmount = inactiveWeeks * TRUST_DECAY.decayPerWeek;

  // Determine floor based on violation history
  const floor = hasViolations ? TRUST_DECAY.floorWithViolations : TRUST_DECAY.floorClean;

  // Calculate new score (don't go below floor)
  const newScore = Math.max(floor, currentScore - decayAmount);
  const actualDecay = currentScore - newScore;

  return {
    shouldDecay: actualDecay > 0,
    decayAmount: actualDecay,
    newScore,
    reason: `${daysSinceActive} days inactive, ${inactiveWeeks} weeks decay applied`,
    floor
  };
}

/**
 * Check if user can gain trust (24h freeze after violation)
 *
 * @param {string} trustFrozenUntil - ISO date string when freeze expires
 * @returns {object} { canGain, frozenUntil, hoursRemaining }
 */
function canGainTrust(trustFrozenUntil) {
  if (!trustFrozenUntil) {
    return { canGain: true, frozenUntil: null, hoursRemaining: 0 };
  }

  const frozenUntil = new Date(trustFrozenUntil);
  const now = new Date();

  if (now >= frozenUntil) {
    return { canGain: true, frozenUntil: null, hoursRemaining: 0 };
  }

  const hoursRemaining = Math.ceil((frozenUntil - now) / (1000 * 60 * 60));
  return {
    canGain: false,
    frozenUntil: trustFrozenUntil,
    hoursRemaining
  };
}

/**
 * Calculate when trust freeze expires (24h after violation)
 */
function calculateTrustFreezeExpiry() {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 24);
  return expiry.toISOString();
}

// ==============================================
// TIER TRANSITIONS
// ==============================================

/**
 * Check if user qualifies for tier upgrade
 * Requires sustained good behavior, not just score
 *
 * @param {object} userStats - User stats from database
 * @param {number} accountAgeDays - Days since account creation
 * @returns {object|null} { newTier, reason } or null if no upgrade
 */
function checkTierUpgrade(userStats, accountAgeDays) {
  const { trust_score, trust_tier, total_battles, clean_battles_since_violation } = userStats;

  if (trust_tier === 'trusted') return null;

  // Standard -> Trusted requirements
  if (trust_tier === 'standard' && trust_score >= 85) {
    if (accountAgeDays >= 30 && total_battles >= 20 && clean_battles_since_violation >= 20) {
      return { newTier: 'trusted', reason: 'Met all Trusted tier requirements' };
    }
    // Return what's missing
    const missing = [];
    if (accountAgeDays < 30) missing.push(`${30 - accountAgeDays} more days account age`);
    if (total_battles < 20) missing.push(`${20 - total_battles} more total battles`);
    if (clean_battles_since_violation < 20) missing.push(`${20 - clean_battles_since_violation} more clean battles`);
    return { newTier: null, missing };
  }

  // Probation -> Standard requirements
  if (trust_tier === 'probation' && trust_score >= 50) {
    if (clean_battles_since_violation >= 15) {
      return { newTier: 'standard', reason: 'Completed probation requirements' };
    }
    return { newTier: null, missing: [`${15 - clean_battles_since_violation} more clean battles`] };
  }

  // Restricted -> Probation requires admin approval (handled separately)
  if (trust_tier === 'restricted') {
    return { newTier: null, requiresAdmin: true, reason: 'Admin approval required to exit restricted' };
  }

  return null;
}

/**
 * Check if user should be demoted
 *
 * @param {object} userStats - User stats from database
 * @returns {object|null} { newTier, reason } or null if no demotion
 */
function checkTierDowngrade(userStats) {
  const { trust_score, trust_tier } = userStats;

  if (trust_tier === 'trusted' && trust_score < 85) {
    const newTier = trust_score >= 50 ? 'standard' : trust_score >= 25 ? 'probation' : 'restricted';
    return { newTier, reason: `Score dropped below ${getTierByName(trust_tier).minScore}` };
  }

  if (trust_tier === 'standard' && trust_score < 50) {
    const newTier = trust_score >= 25 ? 'probation' : 'restricted';
    return { newTier, reason: `Score dropped below ${getTierByName(trust_tier).minScore}` };
  }

  if (trust_tier === 'probation' && trust_score < 25) {
    return { newTier: 'restricted', reason: `Score dropped below ${getTierByName(trust_tier).minScore}` };
  }

  return null;
}

// ==============================================
// BEHAVIOR ANOMALY DETECTION (Z-Score Based)
// ==============================================

/**
 * Calculate median from array of values
 */
function calculateMedian(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate MAD (Median Absolute Deviation) - robust measure of spread
 * For normal distributions, σ ≈ 1.4826 × MAD
 */
function calculateMAD(values, median) {
  if (!values || values.length < 2) return null;
  const deviations = values.map(v => Math.abs(v - median));
  return calculateMedian(deviations);
}

/**
 * Detect behavioral anomalies using z-scores against user's personal baseline.
 * This is the v2 approach - comparing against YOUR patterns, not global thresholds.
 * Uses MEDIAN + MAD when available (robust to outliers), falls back to MEAN + variance.
 *
 * @param {object} currentMetrics - Current battle metrics
 * @param {object} baseline - User's historical behavior averages + variances + rolling windows
 * @param {object} context - { difficulty, solveTime }
 * @returns {object} { score, factors, hasBaseline }
 */
function detectBehaviorAnomaly(currentMetrics, baseline, context = {}) {
  if (!baseline || baseline.battles_analyzed < 10) {
    return { score: 0, factors: [], hasBaseline: false };
  }

  const factors = [];
  let totalScore = 0;

  // 1. Typing Speed Anomaly - prefer median if rolling window available
  if (currentMetrics.typingSpeed && baseline.avg_typing_speed > 0) {
    let centerValue, spread;
    const recentSpeeds = baseline.recent_typing_speeds ? JSON.parse(baseline.recent_typing_speeds) : [];

    if (recentSpeeds.length >= 5) {
      // Use median + MAD (robust)
      centerValue = calculateMedian(recentSpeeds);
      const mad = calculateMAD(recentSpeeds, centerValue);
      spread = mad ? mad * 1.4826 : Math.sqrt(baseline.typing_speed_variance || 1); // MAD to σ conversion
    } else {
      // Fall back to mean + variance
      centerValue = baseline.avg_typing_speed;
      spread = Math.sqrt(baseline.typing_speed_variance || Math.pow(baseline.avg_typing_speed * 0.3, 2));
    }

    const stdDev = spread;

    if (stdDev > 0) {
      const zScore = (currentMetrics.typingSpeed - centerValue) / stdDev;

      if (Math.abs(zScore) > 3) {
        totalScore += 0.4;
        factors.push({
          type: 'typing_speed_anomaly',
          severity: 'high',
          message: zScore > 0
            ? `Typing ${((currentMetrics.typingSpeed / centerValue - 1) * 100).toFixed(0)}% faster than usual`
            : `Typing ${((1 - currentMetrics.typingSpeed / centerValue) * 100).toFixed(0)}% slower than usual`,
          zScore: zScore.toFixed(2),
          usedMedian: recentSpeeds.length >= 5
        });
      } else if (Math.abs(zScore) > 2) {
        totalScore += 0.2;
        factors.push({
          type: 'typing_speed_deviation',
          severity: 'medium',
          message: `Typing speed deviates from personal pattern`,
          zScore: zScore.toFixed(2),
          usedMedian: recentSpeeds.length >= 5
        });
      }
    }
  }

  // 2. Paste Frequency Anomaly
  const currentPastes = currentMetrics.pasteCount || 0;
  const avgPastes = baseline.avg_paste_frequency || 0;

  if (currentPastes > avgPastes + 2) {
    const deviation = currentPastes - avgPastes;
    const severity = deviation > 3 ? 'high' : 'medium';
    totalScore += severity === 'high' ? 0.4 : 0.25;
    factors.push({
      type: 'paste_anomaly',
      severity,
      message: `${currentPastes} pastes vs usual ${avgPastes.toFixed(1)}`,
      deviation
    });
  }

  // 3. Solve Time Anomaly (compared to personal history for this difficulty)
  const { difficulty, solveTime } = context;
  if (difficulty && solveTime) {
    const recentTimesKey = `recent_solve_times_${difficulty}`;
    const recentTimes = baseline[recentTimesKey] ? JSON.parse(baseline[recentTimesKey]) : [];

    let centerTime, spreadTime, usedMedian = false;

    if (recentTimes.length >= 5) {
      // Use median + MAD (robust)
      centerTime = calculateMedian(recentTimes);
      const mad = calculateMAD(recentTimes, centerTime);
      spreadTime = mad ? mad * 1.4826 : centerTime * 0.3;
      usedMedian = true;
    } else {
      // Fall back to mean + variance
      centerTime = baseline[`avg_solve_time_${difficulty}`];
      const solveVariance = baseline[`solve_time_variance_${difficulty}`];
      spreadTime = solveVariance ? Math.sqrt(solveVariance) : (centerTime || 60000) * 0.3;
    }

    if (centerTime && centerTime > 0 && spreadTime > 0) {
      const zScore = (centerTime - solveTime) / spreadTime; // Positive if faster than usual

      if (zScore > 2) { // Significantly faster than usual
        totalScore += 0.3;
        factors.push({
          type: 'solve_time_anomaly',
          severity: 'high',
          message: `Solved in ${Math.round(solveTime / 1000)}s vs personal ${usedMedian ? 'median' : 'avg'} ${Math.round(centerTime / 1000)}s`,
          zScore: zScore.toFixed(2),
          usedMedian
        });
      }
    }
  }

  // 4. Focus Loss Pattern
  const currentFocusLosses = currentMetrics.focusLosses || 0;
  const avgFocusLosses = baseline.avg_focus_loss_count || 0;

  if (currentFocusLosses > avgFocusLosses + 3) {
    totalScore += 0.15;
    factors.push({
      type: 'focus_pattern_anomaly',
      severity: 'low',
      message: `${currentFocusLosses} focus losses vs usual ${avgFocusLosses.toFixed(1)}`
    });
  }

  return {
    score: Math.min(totalScore, 1.0),
    factors,
    hasBaseline: true,
    baselineInfo: {
      battlesAnalyzed: baseline.battles_analyzed,
      avgTypingSpeed: baseline.avg_typing_speed,
      avgPasteFrequency: baseline.avg_paste_frequency
    }
  };
}

// ==============================================
// MILESTONE CHECKING
// ==============================================

/**
 * Check for milestone bonuses
 *
 * @param {object} userStats - User stats
 * @param {number} accountAgeDays - Days since account creation
 * @returns {array} Array of { milestone, bonus } to award
 */
function checkMilestones(userStats, accountAgeDays) {
  const claimed = JSON.parse(userStats.milestone_streaks_claimed || '[]');
  const milestones = [];

  const streak = userStats.clean_battles_since_violation || 0;

  // Clean streak milestones
  if (streak >= 10 && !claimed.includes('cleanStreak10')) {
    milestones.push({ milestone: 'cleanStreak10', bonus: TRUST_GAIN.milestones.cleanStreak10 });
  }
  if (streak >= 25 && !claimed.includes('cleanStreak25')) {
    milestones.push({ milestone: 'cleanStreak25', bonus: TRUST_GAIN.milestones.cleanStreak25 });
  }
  if (streak >= 50 && !claimed.includes('cleanStreak50')) {
    milestones.push({ milestone: 'cleanStreak50', bonus: TRUST_GAIN.milestones.cleanStreak50 });
  }

  // Account age milestones (only if no recent violations)
  const hasRecentViolation = userStats.trust_frozen_until && new Date(userStats.trust_frozen_until) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  if (!hasRecentViolation) {
    if (accountAgeDays >= 90 && !claimed.includes('accountAge90Days')) {
      milestones.push({ milestone: 'accountAge90Days', bonus: TRUST_GAIN.milestones.accountAge90Days });
    }
    if (accountAgeDays >= 180 && !claimed.includes('accountAge180Days')) {
      milestones.push({ milestone: 'accountAge180Days', bonus: TRUST_GAIN.milestones.accountAge180Days });
    }
  }

  return milestones;
}

// ==============================================
// UI HELPERS
// ==============================================

/**
 * Get tier display info for UI
 */
function getTierDisplayInfo(tierName) {
  const info = {
    trusted: {
      label: 'Trusted',
      color: 'green',
      icon: 'shield-check',
      description: 'Excellent standing - human review before any action'
    },
    standard: {
      label: 'Standard',
      color: 'blue',
      icon: 'shield',
      description: 'Good standing - normal enforcement'
    },
    probation: {
      label: 'Probation',
      color: 'yellow',
      icon: 'shield-alert',
      description: 'Under review - enhanced monitoring'
    },
    restricted: {
      label: 'Restricted',
      color: 'red',
      icon: 'shield-x',
      description: 'Limited access - immediate action on flags'
    }
  };
  return info[tierName] || info.standard;
}

/**
 * Get improvement tips for user
 */
function getImprovementTips(trustInfo, accountAgeDays) {
  const tips = [];
  const tier = trustInfo.trust_tier || 'standard';
  const score = trustInfo.trust_score || 50;
  const cleanStreak = trustInfo.clean_battles_since_violation || 0;

  if (tier === 'standard') {
    const scoreNeeded = 85 - score;
    const battlesNeeded = Math.max(0, 20 - cleanStreak);
    const daysNeeded = Math.max(0, 30 - accountAgeDays);

    if (scoreNeeded > 0) tips.push(`Earn ${scoreNeeded.toFixed(1)} more trust points to reach Trusted`);
    if (battlesNeeded > 0) tips.push(`Complete ${battlesNeeded} more clean battles`);
    if (daysNeeded > 0) tips.push(`Wait ${daysNeeded} more days (account age requirement)`);
  } else if (tier === 'probation') {
    const scoreNeeded = 50 - score;
    const battlesNeeded = Math.max(0, 15 - cleanStreak);

    if (scoreNeeded > 0) tips.push(`Earn ${scoreNeeded.toFixed(1)} more trust points to exit Probation`);
    if (battlesNeeded > 0) tips.push(`Complete ${battlesNeeded} more clean battles`);
  } else if (tier === 'restricted') {
    tips.push('Contact support to discuss path back to Probation');
    tips.push('Admin approval required to exit Restricted tier');
  }

  // General tips
  tips.push('Avoid using copy-paste during battles');
  tips.push('Keep your browser tab focused during competition');

  return tips;
}

// ==============================================
// EXPORTS
// ==============================================

module.exports = {
  // Constants
  TRUST_TIERS,
  TRUST_GAIN,
  TRUST_LOSS,
  TRUST_DECAY,

  // Tier functions
  getTierFromScore,
  getTierByName,

  // Core v2 function
  determineConsequences,

  // Trust scoring
  calculateTrustGain,
  calculateTrustLoss,
  calculateTrustDecay,
  canGainTrust,
  calculateTrustFreezeExpiry,

  // Tier transitions
  checkTierUpgrade,
  checkTierDowngrade,

  // Behavior anomaly
  detectBehaviorAnomaly,

  // Milestones
  checkMilestones,

  // UI helpers
  getTierDisplayInfo,
  getImprovementTips
};
