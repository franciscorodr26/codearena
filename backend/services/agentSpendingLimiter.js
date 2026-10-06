/**
 * Spending limiter for agent battles
 * Tracks actual API costs per user per day to prevent runaway spending
 * Uses SQLite for persistent storage across server restarts
 */

const logger = require('../utils/logger');
const db = require('../db');

// Cost per battle by model (estimated based on typical token usage)
const MODEL_COSTS = {
  haiku: 0.01,    // ~$0.01 per battle
  sonnet: 0.03,   // ~$0.03 per battle
  opus: 0.15      // ~$0.15 per battle
};

// Spending limits
const LIMITS = {
  free: {
    daily: 1.00,     // $1/day for free users (~100 haiku battles or ~6 opus)
    monthly: 10.00   // $10/month for free users
  },
  pro: {
    daily: 10.00,    // $10/day for pro users
    monthly: 100.00  // $100/month for pro users
  }
};

/**
 * Get today's date string in YYYY-MM-DD format (UTC)
 */
function getTodayDateString() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Get this month's date string in YYYY-MM format (UTC)
 */
function getMonthDateString() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get next day's reset time (midnight UTC)
 */
function getNextDayResetTime() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).getTime();
}

/**
 * Get next month's reset time (1st of next month, midnight UTC)
 */
function getNextMonthResetTime() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime();
}

/**
 * Get or create spending data for a user from database
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Spending data
 */
async function getSpendingData(userId) {
  const todayDate = getTodayDateString();
  const monthDate = getMonthDateString();

  try {
    let row = await db.get(
      'SELECT * FROM agent_spending WHERE user_id = ?',
      [userId]
    );

    if (!row) {
      // Create new record
      await db.run(
        `INSERT INTO agent_spending (user_id, daily_spend, monthly_spend, daily_reset_date, monthly_reset_date)
         VALUES (?, 0, 0, ?, ?)`,
        [userId, todayDate, monthDate]
      );
      return {
        dailySpend: 0,
        monthlySpend: 0,
        dailyResetDate: todayDate,
        monthlyResetDate: monthDate
      };
    }

    let dailySpend = row.daily_spend;
    let monthlySpend = row.monthly_spend;
    let needsUpdate = false;

    // Reset daily spend if new day
    if (row.daily_reset_date !== todayDate) {
      dailySpend = 0;
      needsUpdate = true;
    }

    // Reset monthly spend if new month
    if (row.monthly_reset_date !== monthDate) {
      monthlySpend = 0;
      dailySpend = 0; // Also reset daily on new month
      needsUpdate = true;
    }

    // Update database if resets occurred
    if (needsUpdate) {
      await db.run(
        `UPDATE agent_spending
         SET daily_spend = ?, monthly_spend = ?, daily_reset_date = ?, monthly_reset_date = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [dailySpend, monthlySpend, todayDate, monthDate, userId]
      );
    }

    return {
      dailySpend,
      monthlySpend,
      dailyResetDate: todayDate,
      monthlyResetDate: monthDate
    };
  } catch (err) {
    logger.error(`[Spending] Error getting spending data for user ${userId}: ${err.message}`);
    // Return safe defaults on error
    return {
      dailySpend: 0,
      monthlySpend: 0,
      dailyResetDate: todayDate,
      monthlyResetDate: monthDate
    };
  }
}

/**
 * Check if user can afford a battle with the given model
 * @param {number} userId - User ID
 * @param {string} model - Model name (haiku, sonnet, opus)
 * @param {boolean} isPro - Whether user has pro subscription
 * @returns {Promise<Object>} { allowed, reason, dailySpend, dailyLimit, monthlySpend, monthlyLimit }
 */
async function checkSpendingLimit(userId, model, isPro) {
  const data = await getSpendingData(userId);
  const limits = isPro ? LIMITS.pro : LIMITS.free;
  const cost = MODEL_COSTS[model?.toLowerCase()] || MODEL_COSTS.sonnet;

  // Check daily limit
  if (data.dailySpend + cost > limits.daily) {
    const hoursUntilReset = Math.ceil((getNextDayResetTime() - Date.now()) / (60 * 60 * 1000));
    return {
      allowed: false,
      reason: `Daily spending limit reached ($${limits.daily.toFixed(2)}). Resets in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}.`,
      dailySpend: data.dailySpend,
      dailyLimit: limits.daily,
      monthlySpend: data.monthlySpend,
      monthlyLimit: limits.monthly,
      cost
    };
  }

  // Check monthly limit
  if (data.monthlySpend + cost > limits.monthly) {
    const daysUntilReset = Math.ceil((getNextMonthResetTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      allowed: false,
      reason: `Monthly spending limit reached ($${limits.monthly.toFixed(2)}). Resets in ${daysUntilReset} day${daysUntilReset !== 1 ? 's' : ''}.`,
      dailySpend: data.dailySpend,
      dailyLimit: limits.daily,
      monthlySpend: data.monthlySpend,
      monthlyLimit: limits.monthly,
      cost
    };
  }

  return {
    allowed: true,
    dailySpend: data.dailySpend,
    dailyLimit: limits.daily,
    dailyRemaining: limits.daily - data.dailySpend,
    monthlySpend: data.monthlySpend,
    monthlyLimit: limits.monthly,
    monthlyRemaining: limits.monthly - data.monthlySpend,
    cost
  };
}

// ---------------------------------------------------------------------------
// M8 fix: reservation system to close the check-then-record TOCTOU window.
//
// The old flow was:
//   admission:    checkSpendingLimit(userId, ...)   // read-only
//   completion:   recordSpending(userId, ...)        // write
// Between admission and completion (which can be many minutes for an agent
// battle), N concurrent admissions all observe the same dailySpend value and
// all pass the check, allowing the daily limit to be exceeded by up to N-1x.
//
// Fix: at admission, call reserveSpending(). It atomically does:
//   1. Re-read current spend.
//   2. Reject if spend + cost > limit.
//   3. Otherwise INCREMENT spend by `cost` immediately and return a
//      reservationId so completion can reconcile.
//
// The atomic check + increment is serialized per-userId using an in-process
// promise-chain mutex. (A DB-side atomic UPDATE ... WHERE spend + ? <= limit
// would be stronger across multiple Node processes, but this codebase runs as
// a single Node process behind Railway/Vercel; a per-userId mutex is enough to
// kill the TOCTOU within one process. Multi-process scaling is out of scope.)
//
// At completion, recordSpending() is still called with the actual cost. To
// avoid double-charging, completion now consumes the reservation via
// consumeReservation(): if a reservation exists for this user we subtract the
// reserved amount before recording the actual cost (so the net effect is
// `actualCost`). If a reservation is missing (e.g. legacy call site that never
// reserved), recordSpending falls back to the old behavior.
// ---------------------------------------------------------------------------

// Per-userId serial mutex. Each user gets a promise chain; new ops `await` the
// tail and replace it. Keeps reservations strictly serialized per user without
// blocking unrelated users.
const _userMutexes = new Map();

function _withUserLock(userId, fn) {
  const prev = _userMutexes.get(userId) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn whether prev resolved or rejected
  // Don't let a stuck rejection chain stall future ops.
  _userMutexes.set(userId, next.catch(() => {}));
  return next;
}

// Active reservations: reservationId -> { userId, model, cost, createdAt }
const _reservations = new Map();
let _reservationCounter = 0;

function _newReservationId() {
  _reservationCounter = (_reservationCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `res-${Date.now()}-${_reservationCounter}`;
}

/**
 * Atomically check + reserve spend for a user. Returns
 *   { ok: true,  reservationId, cost, dailySpend, dailyLimit, monthlySpend, monthlyLimit }
 * on success, or
 *   { ok: false, reason, dailySpend, dailyLimit, monthlySpend, monthlyLimit, cost }
 * if the reservation would breach a limit.
 *
 * @param {number} userId
 * @param {string} model
 * @param {boolean} isPro
 */
async function reserveSpending(userId, model, isPro) {
  return _withUserLock(userId, async () => {
    // Re-read latest spend INSIDE the lock so we never race two concurrent
    // callers for the same user.
    const data = await getSpendingData(userId);
    const limits = isPro ? LIMITS.pro : LIMITS.free;
    const cost = MODEL_COSTS[model?.toLowerCase()] || MODEL_COSTS.sonnet;

    if (data.dailySpend + cost > limits.daily) {
      const hoursUntilReset = Math.ceil((getNextDayResetTime() - Date.now()) / (60 * 60 * 1000));
      return {
        ok: false,
        reason: `Daily spending limit reached ($${limits.daily.toFixed(2)}). Resets in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}.`,
        dailySpend: data.dailySpend,
        dailyLimit: limits.daily,
        monthlySpend: data.monthlySpend,
        monthlyLimit: limits.monthly,
        cost
      };
    }

    if (data.monthlySpend + cost > limits.monthly) {
      const daysUntilReset = Math.ceil((getNextMonthResetTime() - Date.now()) / (24 * 60 * 60 * 1000));
      return {
        ok: false,
        reason: `Monthly spending limit reached ($${limits.monthly.toFixed(2)}). Resets in ${daysUntilReset} day${daysUntilReset !== 1 ? 's' : ''}.`,
        dailySpend: data.dailySpend,
        dailyLimit: limits.daily,
        monthlySpend: data.monthlySpend,
        monthlyLimit: limits.monthly,
        cost
      };
    }

    // Persist the increment NOW so the next admission within the same day
    // sees this user's reservation as committed spend. Completion will
    // reconcile actualCost against this reservation.
    try {
      await recordSpending(userId, model, cost);
    } catch (err) {
      logger.error(`[Spending] reserveSpending: failed to commit reservation for user ${userId}: ${err.message}`);
      return {
        ok: false,
        reason: 'Spending limit service temporarily unavailable, please retry.',
        dailySpend: data.dailySpend,
        dailyLimit: limits.daily,
        monthlySpend: data.monthlySpend,
        monthlyLimit: limits.monthly,
        cost
      };
    }

    const reservationId = _newReservationId();
    _reservations.set(reservationId, {
      userId,
      model,
      cost,
      createdAt: Date.now()
    });

    return {
      ok: true,
      reservationId,
      cost,
      dailySpend: data.dailySpend + cost,
      dailyLimit: limits.daily,
      monthlySpend: data.monthlySpend + cost,
      monthlyLimit: limits.monthly
    };
  });
}

/**
 * Look up + remove a reservation. Returns the original reservation, or null
 * if not found.
 */
function _consumeReservation(reservationId) {
  if (!reservationId) return null;
  const r = _reservations.get(reservationId);
  if (!r) return null;
  _reservations.delete(reservationId);
  return r;
}

/**
 * Release a reservation without recording any spend (e.g. battle failed
 * before any tokens were used). Refunds the reserved amount.
 */
async function releaseReservation(reservationId) {
  const r = _consumeReservation(reservationId);
  if (!r) return false;
  try {
    await refundSpending(r.userId, r.model);
    return true;
  } catch (err) {
    logger.error(`[Spending] releaseReservation: failed to refund for user ${r.userId}: ${err.message}`);
    return false;
  }
}

/**
 * Record spending for a completed battle
 * @param {number} userId - User ID
 * @param {string} model - Model used
 * @param {number} actualCost - Optional actual cost (overrides estimate)
 * @param {string} [reservationId] - Optional reservation to reconcile against.
 *        If provided, the reservation's reserved cost is refunded first,
 *        then actualCost is recorded — net effect is exactly actualCost.
 * @returns {Promise<Object>} Updated spending data
 */
async function recordSpending(userId, model, actualCost = null, reservationId = null) {
  // If the caller is reconciling against a reservation, refund the reserved
  // amount first so we don't double-charge.
  if (reservationId) {
    const r = _consumeReservation(reservationId);
    if (r) {
      try {
        await refundSpending(r.userId, r.model);
      } catch (err) {
        logger.warn(`[Spending] recordSpending: reservation refund failed for user ${userId}: ${err.message}`);
      }
    }
  }
  const cost = actualCost ?? (MODEL_COSTS[model?.toLowerCase()] || MODEL_COSTS.sonnet);
  const todayDate = getTodayDateString();
  const monthDate = getMonthDateString();

  try {
    // Upsert spending record
    await db.run(
      `INSERT INTO agent_spending (user_id, daily_spend, monthly_spend, daily_reset_date, monthly_reset_date)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         daily_spend = CASE
           WHEN daily_reset_date = ? THEN daily_spend + ?
           ELSE ?
         END,
         monthly_spend = CASE
           WHEN monthly_reset_date = ? THEN monthly_spend + ?
           ELSE ?
         END,
         daily_reset_date = ?,
         monthly_reset_date = ?,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId, cost, cost, todayDate, monthDate,
        todayDate, cost, cost,  // daily case
        monthDate, cost, cost,  // monthly case
        todayDate, monthDate
      ]
    );

    // Get updated values
    const data = await getSpendingData(userId);

    logger.debug(`[Spending] User ${userId} spent $${cost.toFixed(3)} on ${model} battle. Daily: $${data.dailySpend.toFixed(2)}, Monthly: $${data.monthlySpend.toFixed(2)}`);

    return {
      cost,
      dailySpend: data.dailySpend,
      monthlySpend: data.monthlySpend
    };
  } catch (err) {
    logger.error(`[Spending] Error recording spending for user ${userId}: ${err.message}`);
    return { cost, dailySpend: 0, monthlySpend: 0 };
  }
}

/**
 * Get spending status for a user (without recording)
 * @param {number} userId - User ID
 * @param {boolean} isPro - Whether user has pro subscription
 * @returns {Promise<Object>} Spending status
 */
async function getSpendingStatus(userId, isPro) {
  const data = await getSpendingData(userId);
  const limits = isPro ? LIMITS.pro : LIMITS.free;

  return {
    dailySpend: data.dailySpend,
    dailyLimit: limits.daily,
    dailyRemaining: Math.max(0, limits.daily - data.dailySpend),
    monthlySpend: data.monthlySpend,
    monthlyLimit: limits.monthly,
    monthlyRemaining: Math.max(0, limits.monthly - data.monthlySpend),
    dailyResetTime: getNextDayResetTime(),
    monthlyResetTime: getNextMonthResetTime()
  };
}

/**
 * Refund spending (e.g., if battle fails)
 * @param {number} userId - User ID
 * @param {string} model - Model that was going to be used
 * @returns {Promise<boolean>} Whether refund was successful
 */
async function refundSpending(userId, model) {
  const cost = MODEL_COSTS[model?.toLowerCase()] || MODEL_COSTS.sonnet;

  try {
    const result = await db.run(
      `UPDATE agent_spending
       SET daily_spend = MAX(0, daily_spend - ?),
           monthly_spend = MAX(0, monthly_spend - ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [cost, cost, userId]
    );

    if (result.changes > 0) {
      logger.debug(`[Spending] Refunded $${cost.toFixed(3)} for user ${userId}`);
      return true;
    }
    return false;
  } catch (err) {
    logger.error(`[Spending] Error refunding spending for user ${userId}: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stale reservation GC
//
// _reservations is populated by reserveSpending() at admission time and is
// expected to be drained by either recordSpending(...,reservationId) (battle
// completed) or releaseReservation(reservationId) (battle failed pre-start).
//
// In practice some failure paths in server.js never call back into either
// reconciliation function (see follow-up TODO in commit body), which causes
// _reservations to grow without bound on the long-lived Node process. The
// money is already debited correctly (reserveSpending writes through to the
// agent_spending row), so leaking the in-memory entry is purely a memory leak
// — not a correctness issue — but it still has to be capped.
//
// We sweep entries older than STALE_RESERVATION_MAX_AGE_MS on a 1-hour
// interval. The interval is .unref()'d so it doesn't keep the event loop alive
// in tests / short-lived scripts.
// ---------------------------------------------------------------------------

const STALE_RESERVATION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const STALE_RESERVATION_SWEEP_MS = 60 * 60 * 1000;       // 1 hour

function _cleanupStaleReservations() {
  const now = Date.now();
  let removed = 0;
  for (const [id, r] of _reservations) {
    if (now - r.createdAt > STALE_RESERVATION_MAX_AGE_MS) {
      _reservations.delete(id);
      removed++;
    }
  }
  if (removed > 0) {
    logger.warn(`[Spending] GC swept ${removed} stale reservation(s) older than ${STALE_RESERVATION_MAX_AGE_MS / (60 * 60 * 1000)}h`);
  }
  return removed;
}

// Set up the periodic sweep once at module load. Guarded against test runners
// that may load the module multiple times.
if (!global.__agentSpendingLimiterGcInterval) {
  const interval = setInterval(_cleanupStaleReservations, STALE_RESERVATION_SWEEP_MS);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }
  global.__agentSpendingLimiterGcInterval = interval;
}

/**
 * Test-only helper: synchronously run the stale-reservation sweep and return
 * the number of entries removed.
 */
function _runStaleCleanupForTest() {
  return _cleanupStaleReservations();
}

/**
 * Reset spending for a user (admin function)
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Whether reset was successful
 */
async function resetUserSpending(userId) {
  try {
    await db.run('DELETE FROM agent_spending WHERE user_id = ?', [userId]);
    logger.info(`[Spending] Reset spending for user ${userId}`);
    return true;
  } catch (err) {
    logger.error(`[Spending] Error resetting spending for user ${userId}: ${err.message}`);
    return false;
  }
}

module.exports = {
  checkSpendingLimit,
  reserveSpending,
  releaseReservation,
  recordSpending,
  getSpendingStatus,
  refundSpending,
  resetUserSpending,
  MODEL_COSTS,
  LIMITS,
  // Exported for tests only.
  _reservationsForTest: _reservations,
  _runStaleCleanupForTest,
  STALE_RESERVATION_MAX_AGE_MS
};
