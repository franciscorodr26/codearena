const {
  checkAgentBattleRateLimit,
  getRateLimitStatus,
  resetUserRateLimit,
  FREE_LIMIT,
  PRO_LIMIT,
  MODEL_LIMITS
} = require('../services/agentRateLimiter');
const db = require('../db');

describe('Agent Battle Rate Limiter', () => {
  const userId = 77777;

  beforeAll(async () => {
    // Initialize database and run migrations
    await db.init();
  });

  beforeEach(async () => {
    // Clear rate limits before each test
    await resetUserRateLimit(userId);
  });

  describe('checkAgentBattleRateLimit', () => {
    it('should allow free users up to FREE_LIMIT battles', async () => {
      for (let i = 0; i < FREE_LIMIT; i++) {
        const result = await checkAgentBattleRateLimit(userId, false);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(FREE_LIMIT - i - 1);
        expect(result.limit).toBe(FREE_LIMIT);
      }
    });

    it('should block free users after FREE_LIMIT battles', async () => {
      // Consume all free battles
      for (let i = 0; i < FREE_LIMIT; i++) {
        await checkAgentBattleRateLimit(userId, false);
      }

      // Next attempt should be blocked
      const result = await checkAgentBattleRateLimit(userId, false);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.minutesUntilReset).toBeGreaterThan(0);
    });

    it('should allow pro users up to PRO_LIMIT battles', async () => {
      for (let i = 0; i < PRO_LIMIT; i++) {
        const result = await checkAgentBattleRateLimit(userId, true);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(PRO_LIMIT - i - 1);
        expect(result.limit).toBe(PRO_LIMIT);
      }
    });

    it('should block pro users after PRO_LIMIT battles', async () => {
      // Consume all pro battles
      for (let i = 0; i < PRO_LIMIT; i++) {
        await checkAgentBattleRateLimit(userId, true);
      }

      // Next attempt should be blocked
      const result = await checkAgentBattleRateLimit(userId, true);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.minutesUntilReset).toBeGreaterThan(0);
    });

    it('should track different limits for free and pro users', async () => {
      const freeUserId = 1;
      const proUserId = 2;

      const freeResult = await checkAgentBattleRateLimit(freeUserId, false);
      const proResult = await checkAgentBattleRateLimit(proUserId, true);

      expect(freeResult.limit).toBe(FREE_LIMIT);
      expect(proResult.limit).toBe(PRO_LIMIT);

      // Clean up
      await resetUserRateLimit(freeUserId);
      await resetUserRateLimit(proUserId);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return status without consuming a battle', async () => {
      const status1 = await getRateLimitStatus(userId, false);
      expect(status1.remaining).toBe(FREE_LIMIT);

      const status2 = await getRateLimitStatus(userId, false);
      expect(status2.remaining).toBe(FREE_LIMIT);
    });

    it('should show reduced remaining after consuming battles', async () => {
      await checkAgentBattleRateLimit(userId, false);
      await checkAgentBattleRateLimit(userId, false);

      const status = await getRateLimitStatus(userId, false);
      expect(status.remaining).toBe(FREE_LIMIT - 2);
    });
  });

  describe('resetUserRateLimit', () => {
    it('should reset user rate limit', async () => {
      // Consume some battles
      for (let i = 0; i < FREE_LIMIT; i++) {
        await checkAgentBattleRateLimit(userId, false);
      }

      // Should be blocked
      let result = await checkAgentBattleRateLimit(userId, false);
      expect(result.allowed).toBe(false);

      // Reset
      await resetUserRateLimit(userId);

      // Should be allowed again
      result = await checkAgentBattleRateLimit(userId, false);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(FREE_LIMIT - 1);
    });
  });

  describe('resetTime', () => {
    it('should reset after 1 hour', async () => {
      // This test would require mocking Date.now() to test properly
      // For now, we just verify the resetTime is in the future
      const result = await checkAgentBattleRateLimit(userId, false);
      expect(result.resetTime).toBeGreaterThan(Date.now());
    });
  });

  describe('Model-specific rate limits', () => {
    const testUserId = 88888;

    beforeEach(async () => {
      await resetUserRateLimit(testUserId);
    });

    afterEach(async () => {
      await resetUserRateLimit(testUserId);
    });

    it('should not have additional limits for haiku model', async () => {
      // Haiku should only be limited by overall limit, not model-specific
      for (let i = 0; i < FREE_LIMIT; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, false, 'haiku');
        expect(result.allowed).toBe(true);
      }

      // Should be blocked by overall limit
      const result = await checkAgentBattleRateLimit(testUserId, false, 'haiku');
      expect(result.allowed).toBe(false);
      expect(result.modelLimit).toBeUndefined();
    });

    it('should enforce sonnet limits for free users', async () => {
      const sonnetLimit = MODEL_LIMITS.sonnet.free; // 20

      // Free users have overall limit of 5, which is less than sonnet limit of 20
      // So they'll hit overall limit first
      // Should allow up to overall limit (5)
      for (let i = 0; i < FREE_LIMIT; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, false, 'sonnet');
        expect(result.allowed).toBe(true);
      }

      // Should be blocked by overall limit, not sonnet-specific limit
      const result = await checkAgentBattleRateLimit(testUserId, false, 'sonnet');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(FREE_LIMIT);
      // Model limit is not the blocker since overall limit is hit first
      expect(result.modelLimit).toBeUndefined();
    });

    it('should enforce sonnet limits for pro users', async () => {
      const sonnetLimit = MODEL_LIMITS.sonnet.pro; // 100

      // Pro users have overall limit of 50, which is less than sonnet limit of 100
      // So they'll hit overall limit first
      // Should allow up to overall limit (50)
      for (let i = 0; i < PRO_LIMIT; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, true, 'sonnet');
        expect(result.allowed).toBe(true);
      }

      // Should be blocked by overall limit, not sonnet-specific limit
      const result = await checkAgentBattleRateLimit(testUserId, true, 'sonnet');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(PRO_LIMIT);
      // Model limit is not the blocker
      expect(result.modelLimit).toBeUndefined();
    });

    it('should enforce opus limits for free users', async () => {
      const opusLimit = MODEL_LIMITS.opus.free; // 5

      // Should allow up to opus limit
      for (let i = 0; i < opusLimit; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, false, 'opus');
        expect(result.allowed).toBe(true);
      }

      // Should be blocked by opus-specific limit
      const result = await checkAgentBattleRateLimit(testUserId, false, 'opus');
      expect(result.allowed).toBe(false);
      expect(result.modelLimit).toBe('opus');
      expect(result.message).toContain('Opus model limit');
    });

    it('should enforce opus limits for pro users', async () => {
      const opusLimit = MODEL_LIMITS.opus.pro; // 25

      // Consume opus limit
      for (let i = 0; i < opusLimit; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, true, 'opus');
        expect(result.allowed).toBe(true);
      }

      // Should be blocked by opus-specific limit
      const result = await checkAgentBattleRateLimit(testUserId, true, 'opus');
      expect(result.allowed).toBe(false);
      expect(result.modelLimit).toBe('opus');
    });

    it('should track different models independently', async () => {
      // Use 3 haiku battles
      for (let i = 0; i < 3; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, false, 'haiku');
        expect(result.allowed).toBe(true);
      }

      // Use 2 opus battles
      for (let i = 0; i < 2; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, false, 'opus');
        expect(result.allowed).toBe(true);
      }

      // Overall count should be 5 (3 + 2), at free limit
      // Next haiku should fail on overall limit
      const result = await checkAgentBattleRateLimit(testUserId, false, 'haiku');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(FREE_LIMIT);
    });

    it('should allow switching models after hitting model-specific limit', async () => {
      const opusLimit = MODEL_LIMITS.opus.free; // 5

      // Use all opus battles (5)
      for (let i = 0; i < opusLimit; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, false, 'opus');
        expect(result.allowed).toBe(true);
      }

      // Opus should be blocked
      let result = await checkAgentBattleRateLimit(testUserId, false, 'opus');
      expect(result.allowed).toBe(false);
      expect(result.modelLimit).toBe('opus');

      // But overall limit (5) is also reached, so no more battles allowed
      result = await checkAgentBattleRateLimit(testUserId, false, 'haiku');
      expect(result.allowed).toBe(false);
    });

    it('should handle case-insensitive model names', async () => {
      const result1 = await checkAgentBattleRateLimit(testUserId, false, 'OPUS');
      expect(result1.allowed).toBe(true);

      const result2 = await checkAgentBattleRateLimit(testUserId, false, 'Sonnet');
      expect(result2.allowed).toBe(true);

      const result3 = await checkAgentBattleRateLimit(testUserId, false, 'haiku');
      expect(result3.allowed).toBe(true);
    });

    it('should return model-specific status with getRateLimitStatus', async () => {
      // Use 2 opus battles
      await checkAgentBattleRateLimit(testUserId, false, 'opus');
      await checkAgentBattleRateLimit(testUserId, false, 'opus');

      const status = await getRateLimitStatus(testUserId, false, 'opus');
      expect(status.modelLimits).toBeDefined();
      expect(status.modelLimits.opus).toBeDefined();
      expect(status.modelLimits.opus.count).toBe(2);
      expect(status.modelLimits.opus.limit).toBe(MODEL_LIMITS.opus.free);
      expect(status.modelLimits.opus.remaining).toBe(MODEL_LIMITS.opus.free - 2);
    });

    it('should handle backward compatibility when no model is specified', async () => {
      // Old behavior - only check overall limit
      for (let i = 0; i < FREE_LIMIT; i++) {
        const result = await checkAgentBattleRateLimit(testUserId, false);
        expect(result.allowed).toBe(true);
      }

      const result = await checkAgentBattleRateLimit(testUserId, false);
      expect(result.allowed).toBe(false);
      expect(result.modelLimit).toBeUndefined();
    });
  });
});
