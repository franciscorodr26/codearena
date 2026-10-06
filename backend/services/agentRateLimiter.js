/**
 * Rate limiter for agent battles
 * Tracks usage per user per hour to control costs
 * Persistent storage using SQLite
 */

const db = require('../db');

// Base rate limits (overall battles per hour)
const FREE_LIMIT = 5;   // 5 agent battles per hour for free users
const PRO_LIMIT = 50;   // 50 agent battles per hour for pro users

// Model-specific rate limits (per hour)
const MODEL_LIMITS = {
  haiku: {
    free: null,   // No additional limit for haiku (cheapest)
    pro: null
  },
  sonnet: {
    free: 20,     // Max 20 sonnet battles per hour for free users
    pro: 100      // Max 100 sonnet battles per hour for pro users
  },
  opus: {
    free: 5,      // Max 5 opus battles per hour for free users
    pro: 25       // Max 25 opus battles per hour for pro users
  }
};

/**
 * Check and update rate limit for a user
 * @param {number} userId - User ID
 * @param {boolean} isPro - Whether user has active pro subscription
 * @param {string} model - Model being used (haiku, sonnet, opus) - optional for backward compatibility
 * @returns {Promise<Object>} Rate limit result
 */
async function checkAgentBattleRateLimit(userId, isPro, model = null) {
  const now = Date.now();
  const hourInMs = 60 * 60 * 1000;

  const limit = isPro ? PRO_LIMIT : FREE_LIMIT;

  // Normalize model name to lowercase
  const normalizedModel = model ? model.toLowerCase() : null;

  // Get or create user rate limit data
  let rateLimitData = await db.get(
    'SELECT * FROM agent_rate_limits WHERE user_id = ?',
    [userId]
  );

  if (!rateLimitData || now >= rateLimitData.reset_time) {
    // Create new or reset expired rate limit
    const resetTime = now + hourInMs;

    if (rateLimitData) {
      // Update existing record - reset all counts
      await db.run(
        'UPDATE agent_rate_limits SET request_count = 0, haiku_count = 0, sonnet_count = 0, opus_count = 0, reset_time = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [resetTime, userId]
      );
    } else {
      // Insert new record
      await db.run(
        'INSERT INTO agent_rate_limits (user_id, request_count, haiku_count, sonnet_count, opus_count, reset_time) VALUES (?, 0, 0, 0, 0, ?)',
        [userId, resetTime]
      );
    }

    rateLimitData = {
      user_id: userId,
      request_count: 0,
      haiku_count: 0,
      sonnet_count: 0,
      opus_count: 0,
      reset_time: resetTime
    };
  }

  // Check model-specific limits first (if model is specified)
  if (normalizedModel && MODEL_LIMITS[normalizedModel]) {
    const modelLimit = isPro ? MODEL_LIMITS[normalizedModel].pro : MODEL_LIMITS[normalizedModel].free;

    // Only check if there's a specific limit for this model (null means no limit)
    if (modelLimit !== null) {
      const modelCountField = `${normalizedModel}_count`;
      const modelCount = rateLimitData[modelCountField] || 0;

      if (modelCount >= modelLimit) {
        const secondsUntilReset = Math.ceil((rateLimitData.reset_time - now) / 1000);
        const minutesUntilReset = Math.ceil(secondsUntilReset / 60);
        return {
          allowed: false,
          remaining: 0,
          resetTime: rateLimitData.reset_time,
          minutesUntilReset,
          limit: modelLimit,
          modelLimit: normalizedModel,
          message: `${normalizedModel.charAt(0).toUpperCase() + normalizedModel.slice(1)} model limit reached`
        };
      }
    }
  }

  // Check overall limit
  if (rateLimitData.request_count >= limit) {
    const secondsUntilReset = Math.ceil((rateLimitData.reset_time - now) / 1000);
    const minutesUntilReset = Math.ceil(secondsUntilReset / 60);
    return {
      allowed: false,
      remaining: 0,
      resetTime: rateLimitData.reset_time,
      minutesUntilReset,
      limit
    };
  }

  // RACE CONDITION FIX: Use atomic UPDATE with WHERE clause to prevent concurrent increments
  // This ensures we only increment if the count is still below the limit
  const newCount = rateLimitData.request_count + 1;

  // Also increment model-specific count if model is specified
  if (normalizedModel && ['haiku', 'sonnet', 'opus'].includes(normalizedModel)) {
    const modelCountField = `${normalizedModel}_count`;
    const modelCount = rateLimitData[modelCountField] || 0;
    const newModelCount = modelCount + 1;

    const modelLimit = MODEL_LIMITS[normalizedModel] ? (isPro ? MODEL_LIMITS[normalizedModel].pro : MODEL_LIMITS[normalizedModel].free) : null;

    // Atomic update with both overall and model-specific limit checks
    const whereClause = modelLimit !== null
      ? `user_id = ? AND request_count < ? AND ${modelCountField} < ?`
      : `user_id = ? AND request_count < ?`;
    const params = modelLimit !== null
      ? [newCount, newModelCount, userId, limit, modelLimit]
      : [newCount, newModelCount, userId, limit];

    const result = await db.run(
      `UPDATE agent_rate_limits SET request_count = ?, ${modelCountField} = ?, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause}`,
      params
    );

    // If no rows were updated, it means another request beat us to it and we're now at/over limit
    if (result.changes === 0) {
      // Re-fetch to get current state
      const current = await db.get(
        'SELECT * FROM agent_rate_limits WHERE user_id = ?',
        [userId]
      );
      const secondsUntilReset = Math.ceil((current.reset_time - now) / 1000);
      const minutesUntilReset = Math.ceil(secondsUntilReset / 60);

      // Check which limit was hit
      const currentModelCount = current[modelCountField] || 0;
      if (modelLimit !== null && currentModelCount >= modelLimit) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: current.reset_time,
          minutesUntilReset,
          limit: modelLimit,
          modelLimit: normalizedModel,
          message: `${normalizedModel.charAt(0).toUpperCase() + normalizedModel.slice(1)} model limit reached`
        };
      }

      return {
        allowed: false,
        remaining: 0,
        resetTime: current.reset_time,
        minutesUntilReset,
        limit
      };
    }

    const modelRemaining = modelLimit !== null ? modelLimit - newModelCount : null;

    return {
      allowed: true,
      remaining: limit - newCount,
      resetTime: rateLimitData.reset_time,
      limit,
      modelRemaining,
      modelLimit
    };
  } else {
    // Atomic update with WHERE clause check
    const result = await db.run(
      'UPDATE agent_rate_limits SET request_count = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND request_count < ?',
      [newCount, userId, limit]
    );

    // If no rows were updated, limit was hit by concurrent request
    if (result.changes === 0) {
      const current = await db.get(
        'SELECT * FROM agent_rate_limits WHERE user_id = ?',
        [userId]
      );
      const secondsUntilReset = Math.ceil((current.reset_time - now) / 1000);
      const minutesUntilReset = Math.ceil(secondsUntilReset / 60);
      return {
        allowed: false,
        remaining: 0,
        resetTime: current.reset_time,
        minutesUntilReset,
        limit
      };
    }
  }

  return {
    allowed: true,
    remaining: limit - newCount,
    resetTime: rateLimitData.reset_time,
    limit
  };
}

/**
 * Get current rate limit status without incrementing
 * @param {number} userId - User ID
 * @param {boolean} isPro - Whether user has active pro subscription
 * @param {string} model - Optional model to check specific limits for
 * @returns {Promise<Object>} Rate limit status
 */
async function getRateLimitStatus(userId, isPro, model = null) {
  const now = Date.now();
  const limit = isPro ? PRO_LIMIT : FREE_LIMIT;
  const normalizedModel = model ? model.toLowerCase() : null;

  const rateLimitData = await db.get(
    'SELECT * FROM agent_rate_limits WHERE user_id = ?',
    [userId]
  );

  const resetTime = now + (60 * 60 * 1000);

  if (!rateLimitData || now >= rateLimitData.reset_time) {
    const status = {
      remaining: limit,
      limit,
      resetTime
    };

    // Add model-specific status if requested
    if (normalizedModel && MODEL_LIMITS[normalizedModel]) {
      const modelLimit = isPro ? MODEL_LIMITS[normalizedModel].pro : MODEL_LIMITS[normalizedModel].free;
      status.modelLimits = {
        [normalizedModel]: {
          remaining: modelLimit !== null ? modelLimit : null,
          limit: modelLimit
        }
      };
    }

    return status;
  }

  const remaining = Math.max(0, limit - rateLimitData.request_count);
  const status = {
    remaining,
    limit,
    resetTime: rateLimitData.reset_time
  };

  // Add model-specific status if requested
  if (normalizedModel && MODEL_LIMITS[normalizedModel]) {
    const modelCountField = `${normalizedModel}_count`;
    const modelCount = rateLimitData[modelCountField] || 0;
    const modelLimit = isPro ? MODEL_LIMITS[normalizedModel].pro : MODEL_LIMITS[normalizedModel].free;

    status.modelLimits = {
      [normalizedModel]: {
        remaining: modelLimit !== null ? Math.max(0, modelLimit - modelCount) : null,
        limit: modelLimit,
        count: modelCount
      }
    };
  }

  return status;
}

/**
 * Reset rate limit for a user (admin function)
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
async function resetUserRateLimit(userId) {
  await db.run(
    'DELETE FROM agent_rate_limits WHERE user_id = ?',
    [userId]
  );
}

/**
 * Clean up expired rate limit entries from the database
 * Should be called periodically to prevent unbounded table growth
 * @returns {Promise<number>} Number of entries deleted
 */
async function cleanupExpiredRateLimits() {
  const now = Date.now();
  const result = await db.run(
    'DELETE FROM agent_rate_limits WHERE reset_time < ?',
    [now]
  );
  return result.changes || 0;
}

/**
 * Refund a rate limit slot (decrement count)
 * Used when a match fails after rate limit was consumed
 * @param {number} userId - User ID
 * @param {string} model - Optional model to refund specific count for
 * @returns {Promise<boolean>}
 */
async function refundRateLimitSlot(userId, model = null) {
  const rateLimitData = await db.get(
    'SELECT * FROM agent_rate_limits WHERE user_id = ?',
    [userId]
  );

  if (rateLimitData && rateLimitData.request_count > 0) {
    const normalizedModel = model ? model.toLowerCase() : null;

    // If model is specified and valid, also refund model-specific count
    if (normalizedModel && ['haiku', 'sonnet', 'opus'].includes(normalizedModel)) {
      const modelCountField = `${normalizedModel}_count`;
      const modelCount = rateLimitData[modelCountField] || 0;

      if (modelCount > 0) {
        await db.run(
          `UPDATE agent_rate_limits SET request_count = request_count - 1, ${modelCountField} = ${modelCountField} - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
          [userId]
        );
      } else {
        // Just refund overall count if model count is already 0
        await db.run(
          'UPDATE agent_rate_limits SET request_count = request_count - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          [userId]
        );
      }
    } else {
      await db.run(
        'UPDATE agent_rate_limits SET request_count = request_count - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [userId]
      );
    }
    return true;
  }
  return false;
}

module.exports = {
  checkAgentBattleRateLimit,
  getRateLimitStatus,
  resetUserRateLimit,
  refundRateLimitSlot,
  cleanupExpiredRateLimits,
  FREE_LIMIT,
  PRO_LIMIT,
  MODEL_LIMITS
};
