/**
 * Trust Tier Service Tests
 *
 * Comprehensive tests for the Trust Tier v2 system.
 * Tests all core functions: tier calculation, trust scoring,
 * behavior anomaly detection, and consequence determination.
 */

const {
  TRUST_TIERS,
  TRUST_GAIN,
  TRUST_LOSS,
  TRUST_DECAY,
  getTierFromScore,
  getTierByName,
  determineConsequences,
  calculateTrustGain,
  calculateTrustLoss,
  calculateTrustDecay,
  canGainTrust,
  calculateTrustFreezeExpiry,
  checkTierUpgrade,
  checkTierDowngrade,
  detectBehaviorAnomaly,
  checkMilestones,
  getTierDisplayInfo,
  getImprovementTips
} = require('../services/trustTierService');

// ==============================================
// TIER CLASSIFICATION TESTS
// ==============================================

describe('Tier Classification', () => {
  describe('getTierFromScore', () => {
    test('score 100 returns trusted', () => {
      expect(getTierFromScore(100).name).toBe('trusted');
    });

    test('score 85 returns trusted (boundary)', () => {
      expect(getTierFromScore(85).name).toBe('trusted');
    });

    test('score 84 returns standard', () => {
      expect(getTierFromScore(84).name).toBe('standard');
    });

    test('score 50 returns standard (boundary)', () => {
      expect(getTierFromScore(50).name).toBe('standard');
    });

    test('score 49 returns probation', () => {
      expect(getTierFromScore(49).name).toBe('probation');
    });

    test('score 25 returns probation (boundary)', () => {
      expect(getTierFromScore(25).name).toBe('probation');
    });

    test('score 24 returns restricted', () => {
      expect(getTierFromScore(24).name).toBe('restricted');
    });

    test('score 0 returns restricted', () => {
      expect(getTierFromScore(0).name).toBe('restricted');
    });

    test('negative score returns restricted', () => {
      expect(getTierFromScore(-10).name).toBe('restricted');
    });
  });

  describe('getTierByName', () => {
    test('returns correct tier for each name', () => {
      expect(getTierByName('trusted').minScore).toBe(85);
      expect(getTierByName('standard').minScore).toBe(50);
      expect(getTierByName('probation').minScore).toBe(25);
      expect(getTierByName('restricted').minScore).toBe(0);
    });

    test('returns standard for unknown tier name', () => {
      expect(getTierByName('unknown').name).toBe('standard');
      expect(getTierByName(null).name).toBe('standard');
      expect(getTierByName(undefined).name).toBe('standard');
    });
  });

  describe('consequence multipliers', () => {
    test('trusted has 0.5x multiplier (lenient)', () => {
      expect(TRUST_TIERS.TRUSTED.consequenceMultiplier).toBe(0.5);
    });

    test('standard has 1.0x multiplier (normal)', () => {
      expect(TRUST_TIERS.STANDARD.consequenceMultiplier).toBe(1.0);
    });

    test('probation has 1.5x multiplier (accelerated)', () => {
      expect(TRUST_TIERS.PROBATION.consequenceMultiplier).toBe(1.5);
    });

    test('restricted has 2.0x multiplier (immediate)', () => {
      expect(TRUST_TIERS.RESTRICTED.consequenceMultiplier).toBe(2.0);
    });
  });
});

// ==============================================
// TRUST GAIN TESTS
// ==============================================

describe('Trust Gain Calculation', () => {
  describe('calculateTrustGain', () => {
    test('base gain for clean battle', () => {
      const result = calculateTrustGain('loss', 'easy', {});
      expect(result.gain).toBe(0.5);
      expect(result.cappedGain).toBe(0.5);
    });

    test('win bonus applied', () => {
      const result = calculateTrustGain('win', 'easy', {});
      expect(result.gain).toBe(0.75); // 0.5 + 0.25
    });

    test('difficulty bonus for medium', () => {
      const result = calculateTrustGain('loss', 'medium', {});
      expect(result.gain).toBe(0.6); // 0.5 + 0.1
    });

    test('difficulty bonus for hard', () => {
      const result = calculateTrustGain('loss', 'hard', {});
      expect(result.gain).toBe(0.7); // 0.5 + 0.2
    });

    test('max gain per battle is 0.95', () => {
      const result = calculateTrustGain('win', 'hard', {});
      expect(result.gain).toBe(0.95); // 0.5 + 0.25 + 0.2 = 0.95
    });

    test('daily cap applied when exceeded', () => {
      const result = calculateTrustGain('win', 'hard', { dailyGainedSoFar: 2.5 });
      expect(result.cappedGain).toBe(0.5); // Only 0.5 remaining of daily cap 3
      expect(result.hitDailyCap).toBe(true);
    });

    test('no gain when daily cap exhausted', () => {
      const result = calculateTrustGain('win', 'hard', { dailyGainedSoFar: 3 });
      expect(result.cappedGain).toBe(0);
      expect(result.hitDailyCap).toBe(true);
    });

    test('breakdown includes all components', () => {
      const result = calculateTrustGain('win', 'hard', {});
      expect(result.breakdown).toContain('Base: +0.5');
      expect(result.breakdown).toContain('Win bonus: +0.25');
      expect(result.breakdown).toContain('hard difficulty: +0.2');
    });
  });
});

// ==============================================
// TRUST LOSS TESTS
// ==============================================

describe('Trust Loss Calculation', () => {
  describe('calculateTrustLoss', () => {
    test('warning severity', () => {
      expect(calculateTrustLoss('warning')).toBe(-3);
    });

    test('serious severity', () => {
      expect(calculateTrustLoss('serious')).toBe(-10);
    });

    test('critical severity', () => {
      expect(calculateTrustLoss('critical')).toBe(-20);
    });

    test('admin confirmed cheating', () => {
      expect(calculateTrustLoss('cheating', 'admin_confirmed')).toBe(-40);
    });

    test('admin confirmed multiple accounts', () => {
      expect(calculateTrustLoss('multipleAccounts', 'admin_confirmed')).toBe(-30);
    });

    test('24h suspension discipline', () => {
      expect(calculateTrustLoss('suspension24h', 'discipline')).toBe(-15);
    });

    test('7d suspension discipline', () => {
      expect(calculateTrustLoss('suspension7d', 'discipline')).toBe(-25);
    });

    test('permanent ban discipline', () => {
      expect(calculateTrustLoss('permanentBan', 'discipline')).toBe(-100);
    });

    test('unknown severity returns default', () => {
      expect(calculateTrustLoss('unknown')).toBe(-5);
    });
  });
});

// ==============================================
// TRUST DECAY TESTS
// ==============================================

describe('Trust Decay Calculation', () => {
  describe('calculateTrustDecay', () => {
    test('no decay within 30 days', () => {
      const recent = new Date();
      recent.setDate(recent.getDate() - 15); // 15 days ago
      const result = calculateTrustDecay(recent.toISOString(), false, 80);
      expect(result.shouldDecay).toBe(false);
      expect(result.newScore).toBe(80);
    });

    test('decay after 30 days inactive', () => {
      const old = new Date();
      old.setDate(old.getDate() - 45); // 45 days ago = safely past the 30-day threshold by 2 weeks
      const result = calculateTrustDecay(old.toISOString(), false, 80);
      expect(result.shouldDecay).toBe(true);
      expect(result.decayAmount).toBe(2); // 2 weeks × 1 point
      expect(result.newScore).toBe(78);
    });

    test('decay respects clean floor (40)', () => {
      const old = new Date();
      old.setDate(old.getDate() - 200); // Very old
      const result = calculateTrustDecay(old.toISOString(), false, 50);
      expect(result.newScore).toBe(40); // Floor for clean users
    });

    test('decay respects violation floor (25)', () => {
      const old = new Date();
      old.setDate(old.getDate() - 365); // Very old - 1 year
      const result = calculateTrustDecay(old.toISOString(), true, 50);
      expect(result.newScore).toBe(25); // Floor for users with violations
    });

    test('no activity date returns no decay', () => {
      const result = calculateTrustDecay(null, false, 80);
      expect(result.shouldDecay).toBe(false);
    });
  });
});

// ==============================================
// TRUST FREEZE TESTS
// ==============================================

describe('Trust Freeze', () => {
  describe('canGainTrust', () => {
    test('can gain when no freeze', () => {
      const result = canGainTrust(null);
      expect(result.canGain).toBe(true);
    });

    test('cannot gain during active freeze', () => {
      const future = new Date();
      future.setHours(future.getHours() + 12);
      const result = canGainTrust(future.toISOString());
      expect(result.canGain).toBe(false);
      expect(result.hoursRemaining).toBeGreaterThan(0);
    });

    test('can gain after freeze expires', () => {
      const past = new Date();
      past.setHours(past.getHours() - 1);
      const result = canGainTrust(past.toISOString());
      expect(result.canGain).toBe(true);
    });
  });

  describe('calculateTrustFreezeExpiry', () => {
    test('returns date 24 hours in future', () => {
      const expiry = calculateTrustFreezeExpiry();
      const expiryDate = new Date(expiry);
      const now = new Date();
      const hoursDiff = (expiryDate - now) / (1000 * 60 * 60);
      expect(hoursDiff).toBeCloseTo(24, 0);
    });
  });
});

// ==============================================
// TIER TRANSITION TESTS
// ==============================================

describe('Tier Transitions', () => {
  describe('checkTierUpgrade', () => {
    test('standard to trusted with all requirements met', () => {
      const result = checkTierUpgrade({
        trust_score: 90,
        trust_tier: 'standard',
        total_battles: 25,
        clean_battles_since_violation: 25
      }, 45);
      expect(result.newTier).toBe('trusted');
    });

    test('standard to trusted blocked by account age', () => {
      const result = checkTierUpgrade({
        trust_score: 90,
        trust_tier: 'standard',
        total_battles: 25,
        clean_battles_since_violation: 25
      }, 15); // Only 15 days
      expect(result.newTier).toBeNull();
      expect(result.missing).toContain('15 more days account age');
    });

    test('standard to trusted blocked by battles', () => {
      const result = checkTierUpgrade({
        trust_score: 90,
        trust_tier: 'standard',
        total_battles: 10,
        clean_battles_since_violation: 10
      }, 45);
      expect(result.newTier).toBeNull();
      expect(result.missing).toContain('10 more total battles');
    });

    test('probation to standard with requirements', () => {
      const result = checkTierUpgrade({
        trust_score: 55,
        trust_tier: 'probation',
        clean_battles_since_violation: 20
      }, 10);
      expect(result.newTier).toBe('standard');
    });

    test('probation to standard blocked by battles', () => {
      const result = checkTierUpgrade({
        trust_score: 55,
        trust_tier: 'probation',
        clean_battles_since_violation: 5
      }, 10);
      expect(result.newTier).toBeNull();
      expect(result.missing).toContain('10 more clean battles');
    });

    test('restricted requires admin approval', () => {
      const result = checkTierUpgrade({
        trust_score: 30,
        trust_tier: 'restricted'
      }, 100);
      expect(result.requiresAdmin).toBe(true);
    });

    test('already trusted returns null', () => {
      const result = checkTierUpgrade({
        trust_score: 95,
        trust_tier: 'trusted'
      }, 100);
      expect(result).toBeNull();
    });
  });

  describe('checkTierDowngrade', () => {
    test('trusted demoted when score drops below 85', () => {
      const result = checkTierDowngrade({
        trust_score: 80,
        trust_tier: 'trusted'
      });
      expect(result.newTier).toBe('standard');
    });

    test('trusted drops to probation when score is low', () => {
      const result = checkTierDowngrade({
        trust_score: 40,
        trust_tier: 'trusted'
      });
      expect(result.newTier).toBe('probation');
    });

    test('standard demoted when score drops below 50', () => {
      const result = checkTierDowngrade({
        trust_score: 45,
        trust_tier: 'standard'
      });
      expect(result.newTier).toBe('probation');
    });

    test('probation demoted when score drops below 25', () => {
      const result = checkTierDowngrade({
        trust_score: 20,
        trust_tier: 'probation'
      });
      expect(result.newTier).toBe('restricted');
    });

    test('no demotion when score is in range', () => {
      const result = checkTierDowngrade({
        trust_score: 60,
        trust_tier: 'standard'
      });
      expect(result).toBeNull();
    });
  });
});

// ==============================================
// BEHAVIOR ANOMALY DETECTION TESTS
// ==============================================

describe('Behavior Anomaly Detection', () => {
  describe('detectBehaviorAnomaly', () => {
    test('returns no baseline when insufficient history', () => {
      const result = detectBehaviorAnomaly(
        { typingSpeed: 5 },
        { battles_analyzed: 5 }
      );
      expect(result.hasBaseline).toBe(false);
      expect(result.score).toBe(0);
    });

    test('detects typing speed anomaly (z > 3)', () => {
      const result = detectBehaviorAnomaly(
        { typingSpeed: 10 }, // Very fast
        {
          battles_analyzed: 20,
          avg_typing_speed: 3,
          typing_speed_variance: 1 // stddev = 1
        }
      );
      expect(result.score).toBeGreaterThan(0);
      expect(result.factors.some(f => f.type === 'typing_speed_anomaly')).toBe(true);
    });

    test('detects paste anomaly', () => {
      const result = detectBehaviorAnomaly(
        { pasteCount: 8 },
        {
          battles_analyzed: 20,
          avg_paste_frequency: 1
        }
      );
      expect(result.factors.some(f => f.type === 'paste_anomaly')).toBe(true);
    });

    test('uses median when rolling window available', () => {
      const result = detectBehaviorAnomaly(
        { typingSpeed: 10 },
        {
          battles_analyzed: 20,
          avg_typing_speed: 3,
          typing_speed_variance: 1,
          recent_typing_speeds: JSON.stringify([2.8, 3.0, 3.2, 3.1, 2.9])
        }
      );
      // Should use median-based detection
      expect(result.hasBaseline).toBe(true);
      if (result.factors.length > 0) {
        expect(result.factors[0].usedMedian).toBe(true);
      }
    });

    test('detects solve time anomaly', () => {
      const result = detectBehaviorAnomaly(
        {},
        {
          battles_analyzed: 20,
          avg_solve_time_medium: 300000, // 5 min average
          solve_time_variance_medium: 10000
        },
        { difficulty: 'medium', solveTime: 60000 } // Solved in 1 min (much faster)
      );
      expect(result.factors.some(f => f.type === 'solve_time_anomaly')).toBe(true);
    });

    test('score capped at 1.0', () => {
      const result = detectBehaviorAnomaly(
        { typingSpeed: 100, pasteCount: 50, focusLosses: 20 },
        {
          battles_analyzed: 20,
          avg_typing_speed: 3,
          typing_speed_variance: 0.5,
          avg_paste_frequency: 0,
          avg_focus_loss_count: 1
        }
      );
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    test('no anomaly when behavior matches baseline', () => {
      const result = detectBehaviorAnomaly(
        { typingSpeed: 3.1, pasteCount: 1, focusLosses: 1 },
        {
          battles_analyzed: 20,
          avg_typing_speed: 3,
          typing_speed_variance: 1,
          avg_paste_frequency: 1,
          avg_focus_loss_count: 1
        }
      );
      expect(result.score).toBe(0);
      expect(result.factors.length).toBe(0);
    });
  });
});

// ==============================================
// CONSEQUENCE DETERMINATION TESTS
// ==============================================

describe('Consequence Determination', () => {
  describe('determineConsequences', () => {
    const mockAnalysis = (suspicion) => ({
      totalSuspicion: suspicion,
      violations: suspicion > 0 ? ['test_violation'] : []
    });

    test('trusted user gets human review, not auto-discipline', () => {
      const result = determineConsequences(
        mockAnalysis(2.0), // High suspicion
        { trust_tier: 'trusted' },
        { score: 0.3, hasBaseline: true }
      );
      expect(result.requiresHumanReview).toBe(true);
      expect(result.skipAutoDiscipline).toBe(true);
      expect(result.action).toBe('flag_for_review');
    });

    test('restricted user gets immediate action on low suspicion', () => {
      const result = determineConsequences(
        mockAnalysis(0.5),
        { trust_tier: 'restricted' },
        { score: 0.3, hasBaseline: true }
      );
      expect(result.action).toBe('auto_discipline');
    });

    test('standard user follows progressive discipline', () => {
      const result = determineConsequences(
        mockAnalysis(1.6),
        { trust_tier: 'standard' },
        { score: 0.3, hasBaseline: true }
      );
      expect(result.action).toBe('auto_discipline');
    });

    test('low anomaly score reduces effective suspicion', () => {
      const highAnomaly = determineConsequences(
        mockAnalysis(1.0),
        { trust_tier: 'standard' },
        { score: 0.8, hasBaseline: true }
      );
      const lowAnomaly = determineConsequences(
        mockAnalysis(1.0),
        { trust_tier: 'standard' },
        { score: 0.1, hasBaseline: true }
      );
      expect(lowAnomaly.effectiveSuspicion).toBeLessThan(highAnomaly.effectiveSuspicion);
    });

    test('reasoning includes tier context', () => {
      const result = determineConsequences(
        mockAnalysis(1.0),
        { trust_tier: 'probation' },
        { score: 0.3, hasBaseline: true }
      );
      expect(result.reasoning.some(r => r.includes('Probation'))).toBe(true);
    });

    test('reasoning includes anomaly context when baseline exists', () => {
      const result = determineConsequences(
        mockAnalysis(0.5),
        { trust_tier: 'standard' },
        { score: 0.1, hasBaseline: true }
      );
      expect(result.reasoning.some(r => r.includes('personal pattern'))).toBe(true);
    });
  });
});

// ==============================================
// MILESTONE TESTS
// ==============================================

describe('Milestone Checking', () => {
  describe('checkMilestones', () => {
    test('awards 10 clean streak milestone', () => {
      const result = checkMilestones({
        clean_battles_since_violation: 12,
        milestone_streaks_claimed: '[]'
      }, 10);
      expect(result.some(m => m.milestone === 'cleanStreak10')).toBe(true);
      expect(result.find(m => m.milestone === 'cleanStreak10').bonus).toBe(3);
    });

    test('does not re-award claimed milestone', () => {
      const result = checkMilestones({
        clean_battles_since_violation: 12,
        milestone_streaks_claimed: '["cleanStreak10"]'
      }, 10);
      expect(result.some(m => m.milestone === 'cleanStreak10')).toBe(false);
    });

    test('awards multiple milestones at once', () => {
      const result = checkMilestones({
        clean_battles_since_violation: 55,
        milestone_streaks_claimed: '[]'
      }, 100);
      expect(result.some(m => m.milestone === 'cleanStreak10')).toBe(true);
      expect(result.some(m => m.milestone === 'cleanStreak25')).toBe(true);
      expect(result.some(m => m.milestone === 'cleanStreak50')).toBe(true);
    });

    test('awards account age milestone', () => {
      const result = checkMilestones({
        clean_battles_since_violation: 5,
        milestone_streaks_claimed: '[]'
      }, 95);
      expect(result.some(m => m.milestone === 'accountAge90Days')).toBe(true);
    });
  });
});

// ==============================================
// UI HELPER TESTS
// ==============================================

describe('UI Helpers', () => {
  describe('getTierDisplayInfo', () => {
    test('returns correct info for each tier', () => {
      expect(getTierDisplayInfo('trusted').color).toBe('green');
      expect(getTierDisplayInfo('standard').color).toBe('blue');
      expect(getTierDisplayInfo('probation').color).toBe('yellow');
      expect(getTierDisplayInfo('restricted').color).toBe('red');
    });

    test('returns standard for unknown tier', () => {
      expect(getTierDisplayInfo('unknown').color).toBe('blue');
    });
  });

  describe('getImprovementTips', () => {
    test('provides tips for standard tier', () => {
      const tips = getImprovementTips({
        trust_tier: 'standard',
        trust_score: 70,
        clean_battles_since_violation: 10
      }, 20);
      expect(tips.some(t => t.includes('trust points'))).toBe(true);
      expect(tips.some(t => t.includes('clean battles'))).toBe(true);
    });

    test('provides tips for probation tier', () => {
      const tips = getImprovementTips({
        trust_tier: 'probation',
        trust_score: 40,
        clean_battles_since_violation: 5
      }, 10);
      expect(tips.some(t => t.includes('exit Probation'))).toBe(true);
    });

    test('restricted tier mentions admin', () => {
      const tips = getImprovementTips({
        trust_tier: 'restricted',
        trust_score: 20
      }, 10);
      expect(tips.some(t => t.includes('Admin'))).toBe(true);
    });
  });
});

// ==============================================
// CONSTANTS VALIDATION
// ==============================================

describe('Constants Validation', () => {
  test('trust gain constants are reasonable', () => {
    expect(TRUST_GAIN.dailyCap).toBe(3);
    expect(TRUST_GAIN.cleanBattle.base).toBe(0.5);
    expect(TRUST_GAIN.cleanBattle.winBonus).toBe(0.25);
  });

  test('trust loss constants are negative', () => {
    expect(TRUST_LOSS.violation.warning).toBeLessThan(0);
    expect(TRUST_LOSS.violation.serious).toBeLessThan(0);
    expect(TRUST_LOSS.violation.critical).toBeLessThan(0);
  });

  test('decay constants are sensible', () => {
    expect(TRUST_DECAY.inactivityThresholdDays).toBe(30);
    expect(TRUST_DECAY.floorClean).toBeGreaterThan(TRUST_DECAY.floorWithViolations);
  });

  test('tier minScores are ordered correctly', () => {
    expect(TRUST_TIERS.TRUSTED.minScore).toBeGreaterThan(TRUST_TIERS.STANDARD.minScore);
    expect(TRUST_TIERS.STANDARD.minScore).toBeGreaterThan(TRUST_TIERS.PROBATION.minScore);
    expect(TRUST_TIERS.PROBATION.minScore).toBeGreaterThan(TRUST_TIERS.RESTRICTED.minScore);
  });
});
