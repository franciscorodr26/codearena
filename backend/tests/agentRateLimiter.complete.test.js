// Isolate this suite on a throwaway temp DB. The rate limiter writes to the
// agent_rate_limits table on every check; against the shared data.sqlite, parallel
// jest workers contend on the same file and intermittently reject with SQLITE_BUSY
// (green in isolation, flaky in the full suite). DB_PATH must be set before db.js
// (required transitively via agentRateLimiter) reads it at module load.
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP_DB = path.join(os.tmpdir(), `agent_rate_limiter_${Date.now()}_${process.pid}.sqlite`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = 'test';

const {
  checkAgentBattleRateLimit,
  getRateLimitStatus,
  resetUserRateLimit,
  refundRateLimitSlot,
  FREE_LIMIT,
  PRO_LIMIT,
  MODEL_LIMITS
} = require('../services/agentRateLimiter');
const db = require('../db');

describe('Agent Battle Rate Limiter - Complete Suite', () => {
  const userId = 12345;

  beforeAll(async () => {
    // Initialize database and run migrations
    await db.init();
  });

  afterAll(() => {
    try { fs.unlinkSync(TMP_DB); } catch (_) {}
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
      expect(result.resetTime).toBeGreaterThan(Date.now());
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

    it('should handle different users independently', async () => {
      const user1 = 100;
      const user2 = 200;

      // User 1 uses their limit
      for (let i = 0; i < FREE_LIMIT; i++) {
        await checkAgentBattleRateLimit(user1, false);
      }

      // User 2 should still have full limit
      const result = await checkAgentBattleRateLimit(user2, false);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(FREE_LIMIT - 1);

      // Clean up
      await resetUserRateLimit(user1);
      await resetUserRateLimit(user2);
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
      expect(status.limit).toBe(FREE_LIMIT);
    });

    it('should return correct remaining when limit is exhausted', async () => {
      // Consume all battles
      for (let i = 0; i < FREE_LIMIT; i++) {
        await checkAgentBattleRateLimit(userId, false);
      }

      const status = await getRateLimitStatus(userId, false);
      expect(status.remaining).toBe(0);
    });

    it('should return future resetTime', async () => {
      const status = await getRateLimitStatus(userId, false);
      expect(status.resetTime).toBeGreaterThan(Date.now());
    });

    it('should handle different isPro states correctly', async () => {
      const freeStatus = await getRateLimitStatus(userId, false);
      const proStatus = await getRateLimitStatus(userId, true);

      expect(freeStatus.limit).toBe(FREE_LIMIT);
      expect(freeStatus.remaining).toBe(FREE_LIMIT);
      expect(proStatus.limit).toBe(PRO_LIMIT);
      expect(proStatus.remaining).toBe(PRO_LIMIT);
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

    it('should work for users who have not used their limit', async () => {
      const newUserId = 999;
      await resetUserRateLimit(newUserId);

      // Should work normally
      const result = await checkAgentBattleRateLimit(newUserId, false);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(FREE_LIMIT - 1);

      // Clean up
      await resetUserRateLimit(newUserId);
    });

    it('should reset count but preserve user isolation', async () => {
      const user1 = 1001;
      const user2 = 1002;

      // Both users consume battles
      await checkAgentBattleRateLimit(user1, false);
      await checkAgentBattleRateLimit(user2, false);

      // Reset user1
      await resetUserRateLimit(user1);

      // User1 should have full limit
      const status1 = await getRateLimitStatus(user1, false);
      expect(status1.remaining).toBe(FREE_LIMIT);

      // User2 should still have reduced limit
      const status2 = await getRateLimitStatus(user2, false);
      expect(status2.remaining).toBe(FREE_LIMIT - 1);

      // Clean up
      await resetUserRateLimit(user1);
      await resetUserRateLimit(user2);
    });
  });

  describe('refundRateLimitSlot', () => {
    it('should refund a consumed slot', async () => {
      // Consume 3 battles
      await checkAgentBattleRateLimit(userId, false);
      await checkAgentBattleRateLimit(userId, false);
      await checkAgentBattleRateLimit(userId, false);

      // Check remaining
      let status = await getRateLimitStatus(userId, false);
      expect(status.remaining).toBe(FREE_LIMIT - 3);

      // Refund one
      const refunded = await refundRateLimitSlot(userId);
      expect(refunded).toBe(true);

      // Should have one more remaining
      status = await getRateLimitStatus(userId, false);
      expect(status.remaining).toBe(FREE_LIMIT - 2);
    });

    it('should return false when user has no consumed slots', async () => {
      // New user with no battles
      const newUserId = 2000;
      const refunded = await refundRateLimitSlot(newUserId);
      expect(refunded).toBe(false);
    });

    it('should return false when user does not exist in store', async () => {
      const nonExistentUser = 9999;
      const refunded = await refundRateLimitSlot(nonExistentUser);
      expect(refunded).toBe(false);
    });

    it('should not refund below zero', async () => {
      const testUserId = 3000;

      // Consume one battle
      await checkAgentBattleRateLimit(testUserId, false);

      // Refund once - should work
      let refunded = await refundRateLimitSlot(testUserId);
      expect(refunded).toBe(true);

      // Try to refund again - should fail
      refunded = await refundRateLimitSlot(testUserId);
      expect(refunded).toBe(false);

      // Clean up
      await resetUserRateLimit(testUserId);
    });

    it('should allow another battle after refund', async () => {
      // Use all battles
      for (let i = 0; i < FREE_LIMIT; i++) {
        await checkAgentBattleRateLimit(userId, false);
      }

      // Should be blocked
      let result = await checkAgentBattleRateLimit(userId, false);
      expect(result.allowed).toBe(false);

      // Refund one
      await refundRateLimitSlot(userId);

      // Should be allowed now
      result = await checkAgentBattleRateLimit(userId, false);
      expect(result.allowed).toBe(true);
    });

    it('should work with pro users', async () => {
      const proUserId = 4000;

      // Consume 5 battles
      for (let i = 0; i < 5; i++) {
        await checkAgentBattleRateLimit(proUserId, true);
      }

      let status = await getRateLimitStatus(proUserId, true);
      expect(status.remaining).toBe(PRO_LIMIT - 5);

      // Refund 2
      await refundRateLimitSlot(proUserId);
      await refundRateLimitSlot(proUserId);

      status = await getRateLimitStatus(proUserId, true);
      expect(status.remaining).toBe(PRO_LIMIT - 3);

      // Clean up
      await resetUserRateLimit(proUserId);
    });
  });

  describe('resetTime behavior', () => {
    it('should set resetTime 1 hour in future on first call', async () => {
      const now = Date.now();
      const result = await checkAgentBattleRateLimit(userId, false);

      const hourInMs = 60 * 60 * 1000;
      expect(result.resetTime).toBeGreaterThanOrEqual(now + hourInMs - 1000); // Allow 1s tolerance
      expect(result.resetTime).toBeLessThanOrEqual(now + hourInMs + 1000);
    });

    it('should maintain same resetTime across multiple calls', async () => {
      const result1 = await checkAgentBattleRateLimit(userId, false);
      const resetTime1 = result1.resetTime;

      const result2 = await checkAgentBattleRateLimit(userId, false);
      const resetTime2 = result2.resetTime;

      expect(resetTime1).toBe(resetTime2);
    });

    it('should calculate minutesUntilReset correctly when blocked', async () => {
      // Consume all battles
      for (let i = 0; i < FREE_LIMIT; i++) {
        await checkAgentBattleRateLimit(userId, false);
      }

      // Try one more - should be blocked
      const result = await checkAgentBattleRateLimit(userId, false);
      expect(result.allowed).toBe(false);
      expect(result.minutesUntilReset).toBeGreaterThan(0);
      expect(result.minutesUntilReset).toBeLessThanOrEqual(60);
    });
  });

  describe('edge cases', () => {
    it('should handle userId as string', async () => {
      const stringUserId = '12345';
      const result = await checkAgentBattleRateLimit(stringUserId, false);
      expect(result.allowed).toBe(true);
      await resetUserRateLimit(stringUserId);
    });

    it('should handle isPro as truthy/falsy values', async () => {
      const user1 = 5000;
      const user2 = 5001;

      // Truthy non-boolean
      const result1 = await checkAgentBattleRateLimit(user1, 1);
      expect(result1.limit).toBe(PRO_LIMIT);

      // Falsy non-boolean
      const result2 = await checkAgentBattleRateLimit(user2, 0);
      expect(result2.limit).toBe(FREE_LIMIT);

      await resetUserRateLimit(user1);
      await resetUserRateLimit(user2);
    });

    it('should handle rapid consecutive calls', async () => {
      const results = [];
      for (let i = 0; i < FREE_LIMIT + 2; i++) {
        results.push(await checkAgentBattleRateLimit(userId, false));
      }

      // First FREE_LIMIT should be allowed
      for (let i = 0; i < FREE_LIMIT; i++) {
        expect(results[i].allowed).toBe(true);
      }

      // Next calls should be blocked
      expect(results[FREE_LIMIT].allowed).toBe(false);
      expect(results[FREE_LIMIT + 1].allowed).toBe(false);
    });
  });

  describe('Model-specific rate limits', () => {
    const testUserId = 99999;

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

    it('should refund model-specific counts', async () => {
      // Use 3 opus battles
      await checkAgentBattleRateLimit(testUserId, false, 'opus');
      await checkAgentBattleRateLimit(testUserId, false, 'opus');
      await checkAgentBattleRateLimit(testUserId, false, 'opus');

      // Check status
      let status = await getRateLimitStatus(testUserId, false, 'opus');
      expect(status.modelLimits.opus.count).toBe(3);

      // Refund one opus battle
      await refundRateLimitSlot(testUserId, 'opus');

      // Should have 2 opus battles used
      status = await getRateLimitStatus(testUserId, false, 'opus');
      expect(status.modelLimits.opus.count).toBe(2);
    });
  });
});
